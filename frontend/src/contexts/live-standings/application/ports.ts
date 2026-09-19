import type { Contest, Standings, Submission, User } from '@/src/shared/domain/contest';

export interface LiveContestGateway {
  getContest(contestId: string, signal?: AbortSignal): Promise<Contest>;
  getStandings(contestId: string, signal?: AbortSignal): Promise<Standings>;
  getSubmissions(
    contestId: string,
    handles: string[],
    signal?: AbortSignal,
  ): Promise<Submission[]>;
  getUsers(handles: string[], signal?: AbortSignal): Promise<User[]>;
}
