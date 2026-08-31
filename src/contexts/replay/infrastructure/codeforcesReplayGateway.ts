import { codeforcesFetch } from '@/src/integrations/codeforces/browser/client';
import type {
  CodeforcesApiResponse,
  CodeforcesContestDto,
  CodeforcesMemberDto,
  CodeforcesPartyDto,
  CodeforcesProblemDto,
  CodeforcesProblemResultDto,
  CodeforcesRanklistRowDto,
  CodeforcesStandingsDto,
  CodeforcesSubmissionDto,
  CodeforcesUserDto,
} from '@/src/integrations/codeforces/contracts';
import type { ReplayGateway } from '../application/ports';
import type {
  ReplayContest,
  ReplayMember,
  ReplayParty,
  ReplayProblem,
  ReplayProblemResult,
  ReplayRanklistRow,
  ReplayStandings,
  ReplaySubmission,
  ReplayUser,
} from '../domain/models';

const readResponse = async <Result>(response: Response, message: string): Promise<Result> => {
  if (!response.ok) throw new Error(message);
  const payload = await response.json() as CodeforcesApiResponse<Result>;
  if (payload.status === 'FAILED' || payload.result === undefined) {
    throw new Error(payload.comment || message);
  }
  return payload.result;
};

const mapMember = (member: CodeforcesMemberDto): ReplayMember => ({ ...member });

const mapParty = (party: CodeforcesPartyDto): ReplayParty => ({
  ...party,
  members: party.members.map(mapMember),
});

const mapProblem = (problem: CodeforcesProblemDto): ReplayProblem => ({
  ...problem,
  tags: problem.tags ? [...problem.tags] : undefined,
});

const mapContest = (contest: CodeforcesContestDto): ReplayContest => ({ ...contest });

const mapProblemResult = (result: CodeforcesProblemResultDto): ReplayProblemResult => ({ ...result });

const mapRanklistRow = (row: CodeforcesRanklistRowDto): ReplayRanklistRow => ({
  ...row,
  party: mapParty(row.party),
  problemResults: row.problemResults.map(mapProblemResult),
});

const mapStandings = (standings: CodeforcesStandingsDto): ReplayStandings => ({
  contest: mapContest(standings.contest),
  problems: standings.problems.map(mapProblem),
  rows: standings.rows.map(mapRanklistRow),
});

const mapSubmission = (submission: CodeforcesSubmissionDto): ReplaySubmission => ({
  ...submission,
  problem: mapProblem(submission.problem),
  author: mapParty(submission.author),
});

const mapUser = (user: CodeforcesUserDto): ReplayUser => ({
  handle: user.handle,
  rank: user.rank,
});

export const codeforcesReplayGateway: ReplayGateway = {
  async getStandings(contestId, signal) {
    const response = await codeforcesFetch('contest.standings', { contestId }, { signal });
    const standings = await readResponse<CodeforcesStandingsDto>(response, 'Unable to load contest standings');
    return mapStandings(standings);
  },

  async getSubmissions(contestId, handles, signal) {
    const response = await codeforcesFetch('contest.status', {
      contestId,
      handles: handles.join(';'),
    }, { signal });
    const submissions = await readResponse<CodeforcesSubmissionDto[]>(response, 'Unable to load contest submissions');
    return submissions.map(mapSubmission);
  },

  async getUsers(handles, signal) {
    const response = await codeforcesFetch('user.info', { handles: handles.join(';') }, { signal });
    const users = await readResponse<CodeforcesUserDto[]>(response, 'Unable to load participant ranks');
    return users.map(mapUser);
  },
};
