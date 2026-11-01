import type { Hack } from '@/src/shared/domain/hacks';
import type {
  ReplayStandings,
  ReplaySubmission,
  ReplayUser,
} from '../domain/models';

export interface ReplayGateway {
  getHacks(contestId: string, signal?: AbortSignal): Promise<Hack[]>;
  getStandings(contestId: string, signal?: AbortSignal): Promise<ReplayStandings>;
  getSubmissions(
    contestId: string,
    handles: string[],
    signal?: AbortSignal,
  ): Promise<ReplaySubmission[]>;
  getUsers(handles: string[], signal?: AbortSignal): Promise<ReplayUser[]>;
}
