export type Problem = {
  contestId: number;
  problemSetName: string;
  index: string;
  name: string;
  type: string;
  points: number;
  rating: number;
  tags: string[];
};

export type Member = { handle: string; name: string };

export type Party = {
  contestId: number;
  members: Member[];
  participantType: string;
  teamId: number | undefined;
  teamName: string | undefined;
  ghost: boolean;
  room: number | undefined;
  startTimeSeconds: number | undefined;
  rank: number;
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
  points: number;
  numberOfProblems: number;
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
  preparedBy: string;
  websiteUrl: string;
  description: string;
  difficulty: number;
  kind: string;
  icpcRegion: string;
  country: string;
  city: string;
  season: string;
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
  problemResults: ProblemResult[];
  lastSubmissionTimeSeconds: number;
};

export type Standings = { contest: Contest; problems: Problem[]; rows: RanklistRow[] };

export type User = { handle: string; rank: string };
