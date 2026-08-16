import { codeforcesFetch } from '@/src/integrations/codeforces/browser/client';
import type {
  CodeforcesApiResponse,
  CodeforcesContestDto,
  CodeforcesStandingsDto,
  CodeforcesSubmissionDto,
  CodeforcesUserDto,
} from '@/src/integrations/codeforces/contracts';
import type { LiveContestGateway } from '../application/ports';

const readResponse = async <Result>(response: Response, message: string): Promise<Result> => {
  const payload = await response.json() as CodeforcesApiResponse<Result>;
  if (!response.ok || payload.status === 'FAILED' || payload.result === undefined) {
    throw new Error(payload.comment || message);
  }
  return payload.result;
};

export const codeforcesLiveContestGateway: LiveContestGateway = {
  async getContest(contestId, signal) {
    const response = await codeforcesFetch('contest.info', { contestId }, { signal });
    return readResponse<CodeforcesContestDto>(response, 'Unable to load contest information');
  },

  async getStandings(contestId, signal) {
    const response = await codeforcesFetch('contest.standings', { contestId }, { signal });
    return readResponse<CodeforcesStandingsDto>(response, 'Failed to fetch standings data');
  },

  async getSubmissions(contestId, handles, signal) {
    const response = await codeforcesFetch('contest.status', {
      contestId,
      handles: handles.join(';'),
    }, { signal });
    return readResponse<CodeforcesSubmissionDto[]>(response, 'Failed to fetch submissions data');
  },

  async getUsers(handles, signal) {
    const response = await codeforcesFetch('user.info', { handles: handles.join(';') }, { signal });
    return readResponse<CodeforcesUserDto[]>(response, 'Failed to fetch user information');
  },
};
