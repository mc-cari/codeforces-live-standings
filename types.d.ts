import { type } from "os";

declare global {

  type Problem = {
    contestId: number;
    problemSetName: string;
    index: string;
    name: string;
    type: string;
    points: number;
    rating: number;
    tags: string[];
  }

  type Member = {
    handle: string;
    name: string;
  }

  type Party = {
    contestId: number;
    members: Member[];
    participantType: string;
    teamId: number | undefined;
    teamName: string | undefined;
    ghost: boolean;
    room: number | undefined;
    startTimeSeconds: number | undefined;
    rank: number;
  }

  type Submission = {
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
    numberOfProblems: number ;
  }

  type Contest = {
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
  }

  type RanklistRow = {
    party: Party;
    rank: number;
    points: number;
    penalty: number;
    successfulHackCount: number;
    unsuccessfulHackCount: number;
    problemResults: ProblemResult[];
    lastSubmissionTimeSeconds: number;
  }

  type ProblemResult = {
    points: number;
    penalty: number;
    rejectedAttemptCount: number;
    type: string;
    bestSubmissionTimeSeconds: number;
  }

  type Standings = {
    contest: Contest,
    problems: Problem[],
    rows: RanklistRow[]
  }

  type User = {
    handle: string;
    email: string;
    vkId: string | undefined;
    openId: string | undefined;
    firstName: string | undefined;
    lastName: string | undefined;
    country: string | undefined;
    city: string | undefined;
    organization: string | undefined;
    contribution: number;
    rank: string;
    rating: number;
    maxRank: string;
    maxRating: number;
    lastOnlineTimeSeconds: number;
    registrationTimeSeconds: number;
    friendOfCount: number;
    avatar: string;
    titlePhoto: string;
  }

  interface Dictionary {
    [Key: string]: String;
  }
  
}