import getName from './getName';
import { MAX_SUBMISSIONS_IN_MEMORY } from './constants';

type ReplaySnapshot = {
  localStandings: Map<string, number>;
  standings: Standings;
  submissions: Submission[];
};

const compareRows = (first: RanklistRow, second: RanklistRow) => {
  if (first.points !== second.points) return second.points - first.points;
  if (first.penalty !== second.penalty) return first.penalty - second.penalty;
  return getName(first.party).localeCompare(getName(second.party));
};

export const buildReplaySnapshot = (
  finalStandings: Standings,
  events: Submission[],
  elapsedSeconds: number,
): ReplaySnapshot => {
  const solvedProblems = new Map<string, Set<string>>();
  const rows = finalStandings.rows.map((finalRow) => ({
    ...finalRow,
    party: { ...finalRow.party, members: [...finalRow.party.members] },
    points: 0,
    penalty: 0,
    problemResults: finalRow.problemResults.map((result) => ({
      ...result,
      points: 0,
      penalty: 0,
      rejectedAttemptCount: 0,
      bestSubmissionTimeSeconds: 0,
    })),
  }));
  const rowByName = new Map(rows.map((row) => [getName(row.party), row]));
  const finalResultsByName = new Map(finalStandings.rows.map((row) => [
    getName(row.party),
    row.problemResults,
  ]));
  const releasedSubmissions: Submission[] = [];

  events.forEach((event) => {
    if (event.relativeTimeSeconds > elapsedSeconds) return;

    const participantName = getName(event.author);
    const row = rowByName.get(participantName);
    const problemIndex = finalStandings.problems.findIndex((problem) => problem.index === event.problem.index);
    if (!row || problemIndex < 0) return;

    if (!solvedProblems.has(participantName)) solvedProblems.set(participantName, new Set<string>());
    const solved = solvedProblems.get(participantName) as Set<string>;
    const result = row.problemResults[problemIndex];
    const finalResult = finalResultsByName.get(participantName)?.[problemIndex];

    if (event.verdict === 'OK' && !solved.has(event.problem.index)) {
      solved.add(event.problem.index);
      if (finalResult) {
        result.points = finalResult.points;
        result.penalty = finalResult.penalty;
        result.rejectedAttemptCount = finalResult.rejectedAttemptCount;
        result.bestSubmissionTimeSeconds = finalResult.bestSubmissionTimeSeconds;
      }
    } else if (!solved.has(event.problem.index)) {
      result.rejectedAttemptCount += 1;
    }

    releasedSubmissions.push({
      ...event,
      author: { ...event.author, members: [...event.author.members] },
    });
  });

  rows.forEach((row) => {
    row.points = row.problemResults.reduce((total, result) => total + result.points, 0);
    row.penalty = row.problemResults.reduce((total, result) => total + result.penalty, 0);
  });
  rows.sort(compareRows);

  const localStandings = new Map<string, number>();
  rows.forEach((row, index) => {
    const previousRow = rows[index - 1];
    const position = previousRow && previousRow.points === row.points && previousRow.penalty === row.penalty
      ? localStandings.get(getName(previousRow.party)) as number
      : index + 1;
    row.party.rank = position;
    localStandings.set(getName(row.party), position);
  });

  const solvedCount = new Map(rows.map((row) => [
    getName(row.party),
    row.problemResults.filter((result) => result.points > 0).length,
  ]));
  const rankedSubmissions = releasedSubmissions.reverse().slice(0, MAX_SUBMISSIONS_IN_MEMORY).map((submission) => ({
    ...submission,
    numberOfProblems: solvedCount.get(getName(submission.author)) as number,
    author: {
      ...submission.author,
      rank: localStandings.get(getName(submission.author)) as number,
    },
  }));

  return {
    localStandings,
    standings: { ...finalStandings, rows },
    submissions: rankedSubmissions,
  };
};
