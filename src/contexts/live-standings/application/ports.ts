import type {
  CodeforcesContestDto,
  CodeforcesStandingsDto,
  CodeforcesSubmissionDto,
  CodeforcesUserDto,
} from '@/src/integrations/codeforces/contracts';

export interface LiveContestGateway {
  getContest(contestId: string, signal?: AbortSignal): Promise<CodeforcesContestDto>;
  getStandings(contestId: string, signal?: AbortSignal): Promise<CodeforcesStandingsDto>;
  getSubmissions(
    contestId: string,
    handles: string[],
    signal?: AbortSignal,
  ): Promise<CodeforcesSubmissionDto[]>;
  getUsers(handles: string[], signal?: AbortSignal): Promise<CodeforcesUserDto[]>;
}
