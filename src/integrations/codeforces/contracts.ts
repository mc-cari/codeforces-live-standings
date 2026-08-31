export type CodeforcesProblemDto = {
  contestId?: number;
  problemsetName?: string;
  index: string;
  name: string;
  type: string;
  points?: number;
  rating?: number;
  tags?: string[];
};

export type CodeforcesMemberDto = {
  handle: string;
  name?: string;
};

export type CodeforcesPartyDto = {
  contestId?: number;
  members: CodeforcesMemberDto[];
  participantType: string;
  teamId?: number;
  teamName?: string;
  ghost?: boolean;
  room?: number;
  startTimeSeconds?: number;
};

export type CodeforcesSubmissionDto = {
  id: number;
  contestId: number;
  creationTimeSeconds: number;
  relativeTimeSeconds: number;
  problem: CodeforcesProblemDto;
  author: CodeforcesPartyDto;
  programmingLanguage: string;
  verdict: string;
  testset: string;
  passedTestCount: number;
  timeConsumedMillis: number;
  memoryConsumedBytes: number;
  points?: number;
};

export type CodeforcesContestDto = {
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

export type CodeforcesProblemResultDto = {
  points: number;
  penalty: number;
  rejectedAttemptCount: number;
  type: string;
  bestSubmissionTimeSeconds: number;
};

export type CodeforcesRanklistRowDto = {
  party: CodeforcesPartyDto;
  rank: number;
  points: number;
  penalty: number;
  successfulHackCount: number;
  unsuccessfulHackCount: number;
  problemResults: CodeforcesProblemResultDto[];
  lastSubmissionTimeSeconds: number;
};

export type CodeforcesStandingsDto = {
  contest: CodeforcesContestDto;
  problems: CodeforcesProblemDto[];
  rows: CodeforcesRanklistRowDto[];
};

export type CodeforcesUserDto = {
  handle: string;
  email?: string;
  vkId?: string;
  openId?: string;
  firstName?: string;
  lastName?: string;
  country?: string;
  city?: string;
  organization?: string;
  contribution?: number;
  rank?: string;
  rating?: number;
  maxRank?: string;
  maxRating?: number;
  lastOnlineTimeSeconds?: number;
  registrationTimeSeconds?: number;
  friendOfCount?: number;
  avatar?: string;
  titlePhoto?: string;
};

export type CodeforcesRankedPartyDto = CodeforcesPartyDto & {
  rank: number;
};

export type CodeforcesPresentedSubmissionDto = Omit<CodeforcesSubmissionDto, 'author'> & {
  author: CodeforcesRankedPartyDto;
  numberOfProblems: number;
};

export type CodeforcesApiResponse<Result> = {
  status: 'OK' | 'FAILED';
  result?: Result;
  comment?: string;
};
