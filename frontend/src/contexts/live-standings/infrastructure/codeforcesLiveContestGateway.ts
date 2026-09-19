import { codeforcesFetch } from '@/src/integrations/codeforces/browser/client';
import type {
  CodeforcesApiResponse,
  CodeforcesContestDto,
  CodeforcesStandingsDto,
  CodeforcesSubmissionDto,
  CodeforcesUserDto,
} from '@/src/integrations/codeforces/contracts';
import {
  mapContestDto,
  mapStandingsDto,
  mapSubmissionDto,
  mapUserDto,
} from '@/src/integrations/codeforces/mapper';
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
    return mapContestDto(await readResponse<CodeforcesContestDto>(response, 'Unable to load contest information'));
  },

  async getStandings(contestId, signal) {
    const response = await codeforcesFetch('contest.standings', { contestId }, { signal });
    return mapStandingsDto(await readResponse<CodeforcesStandingsDto>(response, 'Failed to fetch standings data'));
  },

  async getSubmissions(contestId, handles, signal) {
    const response = await codeforcesFetch('contest.status', {
      contestId,
      handles: handles.join(';'),
    }, { signal });
    const submissions = await readResponse<CodeforcesSubmissionDto[]>(response, 'Failed to fetch submissions data');
    return submissions.map(mapSubmissionDto);
  },

  async getUsers(handles, signal) {
    const response = await codeforcesFetch('user.info', { handles: handles.join(';') }, { signal });
    const users = await readResponse<CodeforcesUserDto[]>(response, 'Failed to fetch user information');
    return users.map(mapUserDto);
  },
};
