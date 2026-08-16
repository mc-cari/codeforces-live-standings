import type { Contest } from '@/src/shared/domain/contest';
import type { ParticipantSelection } from '../domain/participantSelection';

export type FriendCredentials = {
  apiKey: string;
  apiSecret: string;
};

export interface ContestSetupGateway {
  listContests(signal?: AbortSignal): Promise<Contest[]>;
  findContest(contestId: number, signal?: AbortSignal): Promise<Contest>;
  importParticipants(
    contestId: number,
    count: number,
    selection: ParticipantSelection,
  ): Promise<string[]>;
  importFriends(credentials: FriendCredentials): Promise<string[]>;
}
