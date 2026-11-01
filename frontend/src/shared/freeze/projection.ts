import { mergeHacks, sameParty, hackPoints, type Hack } from '../domain/hacks.ts';
import type { ReplayStandings, ReplaySubmission } from '../../contexts/replay/domain/models.ts';
import getName from '../domain/party.ts';
import { addMissingParticipantRows } from '../domain/standings.ts';
import { MAX_SUBMISSIONS_IN_MEMORY } from '../config/contestTiming.ts';

export const cellKey = (name: string, problem: string) => JSON.stringify([name, problem]);
export function parseFreeze(minutes: string | string[] | undefined, view: string | string[] | undefined, duration: number) {
  const valid = typeof minutes === 'string' && /^\d+$/.test(minutes)
    && Number.isSafeInteger(Number(minutes)) && Number(minutes) > 0 && Number(minutes) * 60 < duration;
  const invalid = (minutes !== undefined && !valid)
    || (view !== undefined && (view !== 'unfrozen' || !valid));
  return { cutoff: valid && !invalid ? duration - Number(minutes) * 60 : undefined,
    unfrozen: !invalid && view === 'unfrozen',
    warning: invalid ? 'Invalid freeze settings. Freezing is disabled.' : '' };
}

export function projectVisible(standings: ReplayStandings, events: ReplaySubmission[], elapsed: number,
  cutoff?: number, revealed = new Set<string>(), authoritative = false, runningSolvedCount = false,
  hacks: Hack[] = [], baseline?: ReplayStandings) {
  const available = events.filter((event) => event.relativeTimeSeconds >= 0
    && event.relativeTimeSeconds <= Math.min(elapsed, standings.contest.durationSeconds));
  const pending = new Map<string, number>();
  const pendingHacks: Hack[] = [];
  const visibleHacks = mergeHacks([], hacks).filter((hack) => {
    const time = hack.creationTimeSeconds - standings.contest.startTimeSeconds;
    if (time < 0 || Math.min(time, standings.contest.durationSeconds) > elapsed) return false;
    if (!standings.rows.some((row) => sameParty(row.party, hack.hacker) || sameParty(row.party, hack.defender))) return false;
    if (cutoff === undefined || time < cutoff || revealed.has(hackKey(hack.id))) return true;
    pendingHacks.push(hack);
    return false;
  });
  pendingHacks.sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds || a.id - b.id);
  const visible = available.filter((event) => {
    const key = cellKey(getName(event.author), event.problem.index);
    if (cutoff === undefined || event.relativeTimeSeconds < cutoff || revealed.has(key)) return true;
    pending.set(key, (pending.get(key) || 0) + 1);
    return false;
  });
  const reconstructed = addMissingParticipantRows<ReplayStandings, ReplaySubmission>({ ...standings, rows: [] }, visible, getName);
  const byName = new Map(reconstructed.rows.map((row) => [getName(row.party), row]));
  let rows = standings.rows.map((row) => authoritative ? { ...row } : byName.get(getName(row.party)) || {
    ...row, points: 0, penalty: 0, rank: 0, successfulHackCount: 0, unsuccessfulHackCount: 0,
    lastSubmissionTimeSeconds: 0,
    problemResults: standings.problems.map(() => ({ points: 0, penalty: 0, rejectedAttemptCount: 0,
      bestSubmissionTimeSeconds: 0, type: 'FINAL' })),
  });
  if (!authoritative) {
    if (baseline && cutoff !== undefined) {
      rows = rows.map((row) => {
        const frozen = baseline.rows.find((source) => sameParty(source.party, row.party));
        if (!frozen) return row;
        const result = { ...frozen, problemResults: frozen.problemResults.map((cell) => ({ ...cell })) };
        standings.problems.forEach((problem, index) => {
          if (!revealed.has(cellKey(getName(row.party), problem.index))) return;
          const cell = row.problemResults[index];
          result.points += cell.points - result.problemResults[index].points;
          result.penalty += cell.penalty - result.problemResults[index].penalty;
          result.problemResults[index] = cell;
        });
        return result;
      });
    }
    for (const hack of visibleHacks) {
      // An observed official baseline already includes all pre-cutoff hack points.
      if (baseline && cutoff !== undefined && hack.creationTimeSeconds - standings.contest.startTimeSeconds < cutoff) continue;
      const row = rows.find((candidate) => sameParty(candidate.party, hack.hacker));
      if (!row) continue;
      row.points += hackPoints(standings.contest.type, hack.verdict);
      if (hack.verdict === 'HACK_SUCCESSFUL') row.successfulHackCount = (row.successfulHackCount || 0) + 1;
      if (hack.verdict === 'HACK_UNSUCCESSFUL') row.unsuccessfulHackCount = (row.unsuccessfulHackCount || 0) + 1;
    }
  }
  rows.sort((a, b) => b.points - a.points || a.penalty - b.penalty
    || getName(a.party).localeCompare(getName(b.party)));
  const localStandings = new Map<string, number>();
  rows.forEach((row, index) => {
    const previous = rows[index - 1];
    row.rank = previous && row.points === previous.points && row.penalty === previous.penalty
      ? previous.rank : index + 1;
    localStandings.set(getName(row.party), row.rank);
  });
  const solved = new Map(rows.map((row) => [getName(row.party), row.problemResults.filter((r) => r.points > 0).length]));
  const solvedAtEvent = new Map<string, Set<string>>();
  const ascendingVisible = [...visible].sort((a, b) => a.relativeTimeSeconds - b.relativeTimeSeconds || a.id - b.id);
  const solvedByEvent = new Map<number, number>();
  ascendingVisible.forEach((event) => {
    const name = getName(event.author);
    const participantSolved = solvedAtEvent.get(name) || new Set<string>();
    if (event.verdict === 'OK') participantSolved.add(event.problem.index);
    solvedAtEvent.set(name, participantSolved);
    solvedByEvent.set(event.id, participantSolved.size);
  });
  const submissions = ascendingVisible.reverse().slice(0, MAX_SUBMISSIONS_IN_MEMORY).map((event) => ({ ...event,
    author: { ...event.author, rank: localStandings.get(getName(event.author)) || 0 },
    numberOfProblems: runningSolvedCount
      ? solvedByEvent.get(event.id) || 0
      : solved.get(getName(event.author)) || 0,
  }));
  return { standings: { ...standings, rows }, localStandings, submissions, pending, hacks: visibleHacks, pendingHacks };
}

export const hackKey = (id: number) => `hack:${id}`;

export function nextPending(snapshot: ReturnType<typeof projectVisible>) {
  for (const row of [...snapshot.standings.rows].reverse()) {
    for (const problem of snapshot.standings.problems) {
      const key = cellKey(getName(row.party), problem.index);
      if (snapshot.pending.has(key)) return { key, name: getName(row.party), problem: problem.index, hack: false };
    }
    const hack = snapshot.pendingHacks.find((event) => sameParty(row.party, event.hacker) || sameParty(row.party, event.defender));
    if (hack) return { key: hackKey(hack.id), name: getName(row.party), problem: hack.problem.index, hack: true };
  }
  return undefined;
}
