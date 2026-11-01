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

// Application-owned messages: transport adapters map their DTOs into these models.
export type LiveSnapshot = {
  revision: number;
  contest: Contest;
  standings: Standings;
  submissions: Submission[];
  health: { state: string };
};

export type LivePatch = Omit<LiveSnapshot, 'submissions'> & {
  submissionUpserts: Submission[];
};

export interface LiveStreamGateway {
  enabled(): boolean;
  activate(contestId: string, signal?: AbortSignal): Promise<{ state: string; contest: Contest }>;
  connect(
    contestId: string,
    handles: string[],
    onSnapshot: (snapshot: LiveSnapshot) => void,
    onPatch: (patch: LivePatch) => void,
    onState: (state: string, contest?: Contest) => void,
    onError: () => void,
  ): { close(): void };
}
