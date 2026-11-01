import type { Hack } from '../../../shared/domain/hacks';
import { projectVisible } from '../../../shared/freeze/projection';
import type { ReplayStandings, ReplaySubmission } from './models';

export const buildReplaySnapshot = (standings: ReplayStandings, events: ReplaySubmission[], elapsed: number, hacks: Hack[] = []) => (
  projectVisible(standings, events, elapsed, undefined, undefined, elapsed >= standings.contest.durationSeconds, false, hacks)
);
