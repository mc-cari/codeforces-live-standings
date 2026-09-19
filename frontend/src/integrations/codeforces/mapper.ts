import type {
  Contest,
  Member,
  Party,
  Problem,
  RanklistRow,
  Standings,
  Submission,
  User,
} from '@/src/shared/domain/contest';
import type {
  CodeforcesPartyDto,
  CodeforcesProblemDto,
  CodeforcesContestDto,
  CodeforcesStandingsDto,
  CodeforcesSubmissionDto,
  CodeforcesUserDto,
} from './contracts';

export const mapContestDto = (contest: CodeforcesContestDto): Contest => ({
  id: contest.id,
  name: contest.name,
  type: contest.type,
  phase: contest.phase,
  frozen: contest.frozen,
  durationSeconds: contest.durationSeconds,
  startTimeSeconds: contest.startTimeSeconds,
  relativeTimeSeconds: contest.relativeTimeSeconds,
  preparedBy: contest.preparedBy ?? '',
  websiteUrl: contest.websiteUrl ?? '',
  description: contest.description ?? '',
  difficulty: contest.difficulty ?? 0,
  kind: contest.kind ?? '',
  icpcRegion: contest.icpcRegion ?? '',
  country: contest.country ?? '',
  city: contest.city ?? '',
  season: contest.season ?? '',
});

const mapProblemDto = (problem: CodeforcesProblemDto): Problem => ({
  contestId: problem.contestId ?? 0,
  problemSetName: problem.problemsetName ?? '',
  index: problem.index,
  name: problem.name,
  type: problem.type,
  points: problem.points ?? 0,
  rating: problem.rating ?? 0,
  tags: [...(problem.tags ?? [])],
});

const mapPartyDto = (party: CodeforcesPartyDto): Party => ({
  contestId: party.contestId ?? 0,
  members: party.members.map((member): Member => ({
    handle: member.handle,
    name: member.name ?? '',
  })),
  participantType: party.participantType,
  teamId: party.teamId,
  teamName: party.teamName,
  ghost: party.ghost ?? false,
  room: party.room,
  startTimeSeconds: party.startTimeSeconds,
  rank: 0,
});

export const mapSubmissionDto = (submission: CodeforcesSubmissionDto): Submission => ({
  ...submission,
  problem: mapProblemDto(submission.problem),
  author: mapPartyDto(submission.author),
  points: submission.points ?? 0,
  numberOfProblems: 0,
});

export const mapStandingsDto = (standings: CodeforcesStandingsDto): Standings => ({
  contest: mapContestDto(standings.contest),
  problems: standings.problems.map(mapProblemDto),
  rows: standings.rows.map((row): RanklistRow => ({
    ...row,
    party: mapPartyDto(row.party),
    problemResults: row.problemResults.map((result) => ({ ...result })),
  })),
});

export const mapUserDto = (user: CodeforcesUserDto): User => ({
  handle: user.handle,
  rank: user.rank ?? 'unrated',
});
