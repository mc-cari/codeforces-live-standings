import { codeforcesFetch } from '@/src/integrations/codeforces/browser/client';
import { fetchCodeforcesFriends } from '@/src/integrations/codeforces/browser/friends';
import type {
  CodeforcesApiResponse,
  CodeforcesContestDto,
} from '@/src/integrations/codeforces/contracts';
import type { ContestSetupGateway } from '../application/ports';
import { normalizeImportedHandles } from '../domain/participantSelection';

const readResponse = async <Result>(response: Response, fallback: string): Promise<Result> => {
  const payload = await response.json() as CodeforcesApiResponse<Result>;
  if (!response.ok || payload.status === 'FAILED' || payload.result === undefined) {
    throw new Error(payload.comment || fallback);
  }
  return payload.result;
};

export const codeforcesContestSetupGateway: ContestSetupGateway = {
  async listContests(signal) {
    const response = await codeforcesFetch('contest.list', { gym: false }, { signal });
    return readResponse<CodeforcesContestDto[]>(response, 'Unable to load upcoming contests');
  },

  async findContest(contestId, signal) {
    const response = await codeforcesFetch('contest.info', { contestId }, { signal });
    return readResponse<CodeforcesContestDto>(response, 'Contest not found');
  },

  async importParticipants(contestId, count, selection) {
    const response = await codeforcesFetch('participant.import', { contestId, count, selection });
    return readResponse<string[]>(response, 'Failed to import participants');
  },

  async importFriends({ apiKey, apiSecret }) {
    const response = await fetchCodeforcesFriends(apiKey, apiSecret);
    const handles = await readResponse<unknown>(response, 'Unable to import Codeforces friends');
    return normalizeImportedHandles(handles);
  },
};
