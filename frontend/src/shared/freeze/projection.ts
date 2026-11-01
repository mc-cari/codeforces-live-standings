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
  cutoff?: number, revealed = new Set<string>(), authoritative = false, runningSolvedCount = false) {
  const available = events.filter((event) => event.relativeTimeSeconds >= 0
    && event.relativeTimeSeconds <= Math.min(elapsed, standings.contest.durationSeconds));
  const pending = new Map<string, number>();
  const visible = available.filter((event) => {
    const key = cellKey(getName(event.author), event.problem.index);
    if (cutoff === undefined || event.relativeTimeSeconds < cutoff || revealed.has(key)) return true;
    pending.set(key, (pending.get(key) || 0) + 1);
    return false;
  });
  const reconstructed = addMissingParticipantRows<ReplayStandings, ReplaySubmission>({ ...standings, rows: [] }, visible, getName);
  const byName = new Map(reconstructed.rows.map((row) => [getName(row.party), row]));
  const rows = standings.rows.map((row) => authoritative ? { ...row } : byName.get(getName(row.party)) || {
    ...row, points: 0, penalty: 0, rank: 0, successfulHackCount: 0, unsuccessfulHackCount: 0,
    lastSubmissionTimeSeconds: 0,
    problemResults: standings.problems.map(() => ({ points: 0, penalty: 0, rejectedAttemptCount: 0,
      bestSubmissionTimeSeconds: 0, type: 'FINAL' })),
  });
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
  const solvedBeforeEvent = new Map<number, number>();
  ascendingVisible.forEach((event) => {
    const name = getName(event.author);
    const participantSolved = solvedAtEvent.get(name) || new Set<string>();
    solvedBeforeEvent.set(event.id, participantSolved.size);
    if (event.verdict === 'OK') participantSolved.add(event.problem.index);
    solvedAtEvent.set(name, participantSolved);
  });
  const submissions = ascendingVisible.reverse().slice(0, MAX_SUBMISSIONS_IN_MEMORY).map((event) => ({ ...event,
    author: { ...event.author, rank: localStandings.get(getName(event.author)) || 0 },
    numberOfProblems: runningSolvedCount
      ? (solvedBeforeEvent.get(event.id) || 0) + Number(event.verdict === 'OK')
      : solved.get(getName(event.author)) || 0,
  }));
  return { standings: { ...standings, rows }, localStandings, submissions, pending };
}

export function nextPending(snapshot: ReturnType<typeof projectVisible>) {
  for (const row of [...snapshot.standings.rows].reverse()) {
    for (const problem of snapshot.standings.problems) {
      const key = cellKey(getName(row.party), problem.index);
      if (snapshot.pending.has(key)) return { key, name: getName(row.party), problem: problem.index };
    }
  }
  return undefined;
}
