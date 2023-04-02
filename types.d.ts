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
    teamId: number;
    teamName: string;
    ghost: boolean;
    room: number;
    startTimeSeconds: number;
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

  interface Dictionary {
    [Key: string]: String;
  }
  
}