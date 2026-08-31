import type {
  ReplayStandings,
  ReplaySubmission,
  ReplayUser,
} from '../domain/models';

export interface ReplayGateway {
  getStandings(contestId: string, signal?: AbortSignal): Promise<ReplayStandings>;
  getSubmissions(
    contestId: string,
    handles: string[],
    signal?: AbortSignal,
  ): Promise<ReplaySubmission[]>;
  getUsers(handles: string[], signal?: AbortSignal): Promise<ReplayUser[]>;
}
