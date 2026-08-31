import type { Contest } from '@/src/shared/domain/contest';

export type SupportedContestType = 'normal' | 'educational';
export type ContestRoute = 'standings' | 'replay';

export type ContestConfiguration = {
  contestType?: SupportedContestType;
  route: ContestRoute;
  actionLabel: string;
  unsupportedReason?: string;
};

export const getContestConfiguration = (contest: Contest): ContestConfiguration => {
  if (contest.type === 'IOI') {
    return {
      route: contest.phase === 'FINISHED' ? 'replay' : 'standings',
      actionLabel: 'Unsupported contest',
      unsupportedReason: 'IOI scoring is not supported yet.',
    };
  }

  const route = contest.phase === 'FINISHED' ? 'replay' : 'standings';
  return {
    contestType: contest.type === 'ICPC' ? 'educational' : 'normal',
    route,
    actionLabel: contest.phase === 'BEFORE'
      ? 'Open Countdown'
      : route === 'replay' ? 'Start Replay' : 'Start Live Tracking',
  };
};

export const secondsUntilContest = (contest: Contest, nowMilliseconds = Date.now()) => (
  Math.max(0, contest.startTimeSeconds - Math.floor(nowMilliseconds / 1000))
);

export const formatCountdown = (totalSeconds: number) => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600).toString().padStart(2, '0');
  const minutes = Math.floor((seconds % 3_600) / 60).toString().padStart(2, '0');
  const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
  return days > 0
    ? `${days}d ${hours}:${minutes}:${remainingSeconds}`
    : `${hours}:${minutes}:${remainingSeconds}`;
};
