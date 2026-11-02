export type Problem = {
  contestId?: number;
  problemsetName?: string;
  index: string;
  name: string;
  type: string;
  points?: number;
  rating?: number;
  tags?: Array<string>;
};

export type Member = {
  handle: string;
  name?: string;
};

export type Party = {
  contestId?: number;
  members: Array<Member>;
  participantType: string;
  teamId?: number;
  teamName?: string;
  ghost?: boolean;
  room?: number;
  startTimeSeconds?: number;
  rank?: number;
};

export type Submission = {
  id: number;
  contestId: number;
  creationTimeSeconds: number;
  relativeTimeSeconds: number;
  problem: Problem;
  author: Party;
  programmingLanguage: string;
  verdict: string;
  testset: string;
  passedTestCount: number;
  timeConsumedMillis: number;
  memoryConsumedBytes: number;
  points?: number;
};

export type Contest = {
  id: number;
  name: string;
  type: string;
  phase: string;
  frozen: boolean;
  durationSeconds: number;
  startTimeSeconds: number;
  relativeTimeSeconds: number;
  preparedBy?: string;
  websiteUrl?: string;
  description?: string;
  difficulty?: number;
  kind?: string;
  icpcRegion?: string;
  country?: string;
  city?: string;
  season?: string;
};

export type ProblemResult = {
  points: number;
  penalty: number;
  rejectedAttemptCount: number;
  type: string;
  bestSubmissionTimeSeconds: number;
};

export type RanklistRow = {
  party: Party;
  rank: number;
  points: number;
  penalty: number;
  successfulHackCount: number;
  unsuccessfulHackCount: number;
  problemResults: Array<ProblemResult>;
  lastSubmissionTimeSeconds: number;
};

export type Standings = {
  contest: Contest;
  problems: Array<Problem>;
  rows: Array<RanklistRow>;
};

export type Health = {
  state: "warming" | "live" | "stale" | "finished";
};

export type LiveSnapshot = {
  revision: number;
  contest: Contest;
  standings: Standings;
  health: Health;
  submissions: Array<Submission>;
};

export type LivePatch = {
  revision: number;
  contest: Contest;
  standings: Standings;
  health: Health;
  submissionUpserts: Array<Submission>;
};

export type LiveState = {
  state: "warming" | "live" | "stale" | "finished";
  contest: Contest;
};

export type Activation = {
  state: "warming" | "live" | "stale" | "finished";
  contest: Contest;
};
