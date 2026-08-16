import type {
  CodeforcesStandingsDto,
  CodeforcesSubmissionDto,
  CodeforcesUserDto,
} from '@/src/integrations/codeforces/contracts';

export interface ReplayGateway {
  getStandings(contestId: string, signal?: AbortSignal): Promise<CodeforcesStandingsDto>;
  getSubmissions(
    contestId: string,
    handles: string[],
    signal?: AbortSignal,
  ): Promise<CodeforcesSubmissionDto[]>;
  getUsers(handles: string[], signal?: AbortSignal): Promise<CodeforcesUserDto[]>;
}
