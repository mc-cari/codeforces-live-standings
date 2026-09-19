import { MAX_REPLAY_PLAYBACK_SPEED } from '../../../shared/config/contestTiming.ts';

export const formatElapsedTime = (seconds: number) => {
  const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${remainingSeconds}`;
};

export const getQueryValue = (value: string | string[] | undefined) => (
  typeof value === 'string' ? value : undefined
);

export const getPlaybackSpeed = (value: string | undefined) => {
  const speed = Number(value);
  return Number.isFinite(speed) && speed > 0 && speed <= MAX_REPLAY_PLAYBACK_SPEED ? speed : 1;
};

export const getStartTime = (
  value: string | undefined,
  durationSeconds: number,
  replayStart: number,
) => {
  if (!value) return replayStart;
  const timestamp = value.match(/^(\d+):(\d{1,2})$/);
  const seconds = timestamp
    ? Number(timestamp[1]) * 60 + Number(timestamp[2])
    : Number(value) * 60;
  if (!Number.isFinite(seconds) || seconds < 0) return replayStart;
  return Math.max(replayStart, Math.min(durationSeconds, seconds));
};
