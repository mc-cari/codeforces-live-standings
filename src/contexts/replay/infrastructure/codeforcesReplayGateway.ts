import { codeforcesFetch } from '@/src/integrations/codeforces/browser/client';
import type {
  CodeforcesApiResponse,
  CodeforcesStandingsDto,
  CodeforcesSubmissionDto,
  CodeforcesUserDto,
} from '@/src/integrations/codeforces/contracts';
import type { ReplayGateway } from '../application/ports';

const readResponse = async <Result>(response: Response, message: string): Promise<Result> => {
  const payload = await response.json() as CodeforcesApiResponse<Result>;
  if (!response.ok || payload.status === 'FAILED' || payload.result === undefined) {
    throw new Error(payload.comment || message);
  }
  return payload.result;
};

export const codeforcesReplayGateway: ReplayGateway = {
  async getStandings(contestId, signal) {
    const response = await codeforcesFetch('contest.standings', { contestId }, { signal });
    return readResponse<CodeforcesStandingsDto>(response, 'Unable to load contest standings');
  },

  async getSubmissions(contestId, handles, signal) {
    const response = await codeforcesFetch('contest.status', {
      contestId,
      handles: handles.join(';'),
    }, { signal });
    return readResponse<CodeforcesSubmissionDto[]>(response, 'Unable to load contest submissions');
  },

  async getUsers(handles, signal) {
    const response = await codeforcesFetch('user.info', { handles: handles.join(';') }, { signal });
    return readResponse<CodeforcesUserDto[]>(response, 'Unable to load participant ranks');
  },
};
