import type { CodeforcesContestDto } from '@/src/integrations/codeforces/contracts';
import type { ParticipantSelection } from '../domain/participantSelection';

export type FriendCredentials = {
  apiKey: string;
  apiSecret: string;
};

export interface ContestSetupGateway {
  listContests(signal?: AbortSignal): Promise<CodeforcesContestDto[]>;
  findContest(contestId: number, signal?: AbortSignal): Promise<CodeforcesContestDto>;
  importParticipants(
    contestId: number,
    count: number,
    selection: ParticipantSelection,
  ): Promise<string[]>;
  importFriends(credentials: FriendCredentials): Promise<string[]>;
}
