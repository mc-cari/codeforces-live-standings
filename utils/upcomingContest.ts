export const findUpcomingContests = (
  contests: Contest[],
  nowSeconds = Math.floor(Date.now() / 1000),
  limit = 3,
): Contest[] => contests
  .filter((contest) => (
    contest.phase === 'BEFORE' && contest.startTimeSeconds > nowSeconds
  ))
  .sort((first, second) => first.startTimeSeconds - second.startTimeSeconds)
  .slice(0, limit);
