export type ReplayProblem = {
  contestId?: number;
  problemsetName?: string;
  index: string;
  name: string;
  type: string;
  points?: number;
  rating?: number;
  tags?: string[];
};

export type ReplayMember = {
  handle: string;
  name?: string;
};

export type ReplayParty = {
  contestId?: number;
  members: ReplayMember[];
  participantType: string;
  teamId?: number;
  teamName?: string;
  ghost?: boolean;
  room?: number;
  startTimeSeconds?: number;
};

export type ReplayContest = {
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

export type ReplayProblemResult = {
  points: number;
  penalty: number;
  rejectedAttemptCount: number;
  type: string;
  bestSubmissionTimeSeconds: number;
};

export type ReplayRanklistRow = {
  party: ReplayParty;
  rank: number;
  points: number;
  penalty: number;
  successfulHackCount: number;
  unsuccessfulHackCount: number;
  problemResults: ReplayProblemResult[];
  lastSubmissionTimeSeconds: number;
};

export type ReplayStandings = {
  contest: ReplayContest;
  problems: ReplayProblem[];
  rows: ReplayRanklistRow[];
};

export type ReplaySubmission = {
  id: number;
  contestId: number;
  creationTimeSeconds: number;
  relativeTimeSeconds: number;
  problem: ReplayProblem;
  author: ReplayParty;
  programmingLanguage: string;
  verdict: string;
  testset: string;
  passedTestCount: number;
  timeConsumedMillis: number;
  memoryConsumedBytes: number;
  points?: number;
};

export type ReplayPresentedSubmission = Omit<ReplaySubmission, 'author'> & {
  author: ReplayParty & { rank: number };
  numberOfProblems: number;
};

export type ReplayUser = {
  handle: string;
  rank?: string;
};
