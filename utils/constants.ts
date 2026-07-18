export const MAX_SUBMISSIONS_IN_MEMORY = 10_000;

export const LOADING_PROGRESS = {
  initial: 8,
  standingsLoaded: 30,
  submissionsLoaded: 70,
  estimatedMaximum: 95,
  fastIncrement: 3,
  slowIncrement: 1,
  tickMilliseconds: 560,
  complete: 100,
  completionDelayMilliseconds: 250,
};

export const LIVE_POLLING = {
  initialDelayMilliseconds: 100,
  refreshDelayMilliseconds: 1_000,
};

export const REPLAY_SPEED_OPTIONS = [1, 2, 5, 10, 15, 20, 30, 60, 120, 600];
export const MAX_REPLAY_PLAYBACK_SPEED = Math.max(...REPLAY_SPEED_OPTIONS);
export const REPLAY_PLAYBACK_TICK_MILLISECONDS = 50;
export const REPLAY_ARTIFICIAL_JUDGING_SPEED_MAX = 20;
export const REPLAY_RELEASE_BATCH_SIZE = 15;
export const REPLAY_JUDGING_TICK_MILLISECONDS = 80;
export const REPLAY_JUDGING_BASE_DURATION_MILLISECONDS = 1_800;
export const REPLAY_JUDGING_DURATION_VARIATION_MILLISECONDS = 90;
export const REPLAY_JUDGING_MIN_MILESTONES = 3;
export const REPLAY_JUDGING_MAX_MILESTONES = 6;
