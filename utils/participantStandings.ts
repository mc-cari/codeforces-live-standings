type ParticipantName = (party: Party) => string;

const isPenalizedAttempt = (submission: Submission) => (
  submission.verdict !== 'OK'
  && submission.verdict !== 'COMPILATION_ERROR'
  && submission.verdict !== 'SKIPPED'
  && submission.verdict !== 'TESTING'
);

const compareRows = (first: RanklistRow, second: RanklistRow) => {
  if (first.points !== second.points) return second.points - first.points;
  if (first.penalty !== second.penalty) return first.penalty - second.penalty;
  return 0;
};

const createRow = (party: Party, problemCount: number): RanklistRow => ({
  party,
  rank: 0,
  points: 0,
  penalty: 0,
  successfulHackCount: 0,
  unsuccessfulHackCount: 0,
  problemResults: Array.from({ length: problemCount }, () => ({
    points: 0,
    penalty: 0,
    rejectedAttemptCount: 0,
    type: 'FINAL',
    bestSubmissionTimeSeconds: 0,
  })),
  lastSubmissionTimeSeconds: 0,
});

const calculateCfPoints = (
  maximumPoints: number,
  relativeTimeSeconds: number,
  durationSeconds: number,
  rejectedAttemptCount: number,
) => {
  const submissionMinute = Math.floor(relativeTimeSeconds / 60);
  const durationMinutes = durationSeconds / 60;
  const timePenalty = Math.floor(
    (120 * maximumPoints * submissionMinute) / (250 * durationMinutes),
  );
  return Math.max(
    0.3 * maximumPoints,
    maximumPoints - timePenalty - 50 * rejectedAttemptCount,
  );
};

export const addMissingParticipantRows = (
  standings: Standings,
  submissions: Submission[],
  getParticipantName: ParticipantName,
): Standings => {
  const existingNames = new Set(standings.rows.map((row) => getParticipantName(row.party)));
  const missingRows = new Map<string, RanklistRow>();
  const solvedProblems = new Map<string, Set<string>>();
  const problemIndexes = new Map(standings.problems.map((problem, index) => [problem.index, index]));

  submissions
    .filter((submission) => (
      submission.relativeTimeSeconds >= 0
      && submission.relativeTimeSeconds <= standings.contest.durationSeconds
    ))
    .sort((first, second) => first.relativeTimeSeconds - second.relativeTimeSeconds || first.id - second.id)
    .forEach((submission) => {
      const name = getParticipantName(submission.author);
      if (existingNames.has(name)) return;

      const problemIndex = problemIndexes.get(submission.problem.index);
      if (problemIndex === undefined) return;

      if (!missingRows.has(name)) {
        missingRows.set(name, createRow(submission.author, standings.problems.length));
        solvedProblems.set(name, new Set<string>());
      }

      const row = missingRows.get(name) as RanklistRow;
      const result = row.problemResults[problemIndex];
      const solved = solvedProblems.get(name) as Set<string>;
      row.lastSubmissionTimeSeconds = Math.max(
        row.lastSubmissionTimeSeconds,
        submission.relativeTimeSeconds,
      );

      if (submission.verdict === 'OK') {
        if (standings.contest.type === 'ICPC') {
          if (solved.has(submission.problem.index)) return;
          solved.add(submission.problem.index);
          result.points = 1;
          result.bestSubmissionTimeSeconds = submission.relativeTimeSeconds;
          result.penalty = Math.floor(submission.relativeTimeSeconds / 60)
            + result.rejectedAttemptCount * 20;
          row.points += 1;
          row.penalty += result.penalty;
          return;
        }

        const reportedPoints = Number.isFinite(submission.points) ? submission.points : 0;
        const submissionPoints = reportedPoints > 0
          ? reportedPoints
          : calculateCfPoints(
            standings.problems[problemIndex].points || submission.problem.points,
            submission.relativeTimeSeconds,
            standings.contest.durationSeconds,
            result.rejectedAttemptCount,
          );
        if (submissionPoints > result.points) {
          row.points += submissionPoints - result.points;
          result.points = submissionPoints;
          result.bestSubmissionTimeSeconds = submission.relativeTimeSeconds;
        }
      } else if (!solved.has(submission.problem.index) && isPenalizedAttempt(submission)) {
        result.rejectedAttemptCount += 1;
      }
    });

  return {
    ...standings,
    rows: [...standings.rows, ...missingRows.values()].sort(compareRows),
  };
};
