import type { Hack } from '@/src/shared/domain/hacks';
import type { Contest, Standings, Submission, User } from '@/src/shared/domain/contest';

export interface LiveContestGateway {
  getHacks(contestId: string, signal?: AbortSignal): Promise<Hack[]>;
  getContest(contestId: string, signal?: AbortSignal): Promise<Contest>;
  getStandings(contestId: string, signal?: AbortSignal): Promise<Standings>;
  getSubmissions(
    contestId: string,
    handles: string[],
    signal?: AbortSignal,
  ): Promise<Submission[]>;
  getUsers(handles: string[], signal?: AbortSignal): Promise<User[]>;
}
