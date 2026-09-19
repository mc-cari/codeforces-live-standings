type ReplayProblemResult = {
  points: number;
  rejectedAttemptCount: number;
  bestSubmissionTimeSeconds: number;
};

export const countRejectedAttempt = (currentCount: number, finalCount?: number) => (
  finalCount === undefined ? currentCount + 1 : Math.min(currentCount + 1, finalCount)
);

export default function calculateReplayPenalty(
  contestType: string,
  problemResults: ReplayProblemResult[],
) {
  if (contestType !== 'ICPC') return 0;

  return problemResults.reduce((total, result) => (
    result.points > 0
      ? total + Math.floor(result.bestSubmissionTimeSeconds / 60)
        + result.rejectedAttemptCount * 20
      : total
  ), 0);
}
