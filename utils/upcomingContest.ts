export const findUpcomingContests = (
  contests: Contest[],
  nowSeconds = Math.floor(Date.now() / 1000),
  limit = 3,
): Contest[] => contests
  .filter((contest) => (
    contest.phase === 'CODING'
    || (contest.phase === 'BEFORE' && contest.startTimeSeconds > nowSeconds)
  ))
  .sort((first, second) => {
    const firstIsLive = first.phase === 'CODING';
    const secondIsLive = second.phase === 'CODING';

    if (firstIsLive !== secondIsLive) return firstIsLive ? -1 : 1;
    return first.startTimeSeconds - second.startTimeSeconds;
  })
  .slice(0, limit);
