import type { Contest, Standings, Submission, User } from '@/src/shared/domain/contest';
import type {
  CodeforcesContestDto,
  CodeforcesStandingsDto,
  CodeforcesSubmissionDto,
  CodeforcesUserDto,
} from './contracts';

export const mapContestDto = (contest: CodeforcesContestDto): Contest => ({
  ...contest,
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

export const mapSubmissionDto = (submission: CodeforcesSubmissionDto): Submission => ({
  ...submission,
  points: submission.points ?? 0,
  numberOfProblems: 0,
  problem: {
    ...submission.problem,
    contestId: submission.problem.contestId ?? submission.contestId,
    problemSetName: submission.problem.problemsetName ?? '',
    points: submission.problem.points ?? 0,
    rating: submission.problem.rating ?? 0,
    tags: [...(submission.problem.tags ?? [])],
  },
  author: {
    ...submission.author,
    contestId: submission.author.contestId ?? submission.contestId,
    teamId: submission.author.teamId,
    teamName: submission.author.teamName,
    ghost: submission.author.ghost ?? false,
    room: submission.author.room,
    startTimeSeconds: submission.author.startTimeSeconds,
    rank: 0,
    members: submission.author.members.map((member) => ({ ...member, name: member.name ?? '' })),
  },
});

export const mapStandingsDto = (standings: CodeforcesStandingsDto): Standings => ({
  contest: mapContestDto(standings.contest),
  problems: standings.problems.map((problem) => ({
    ...problem,
    contestId: problem.contestId ?? standings.contest.id,
    problemSetName: problem.problemsetName ?? '',
    points: problem.points ?? 0,
    rating: problem.rating ?? 0,
    tags: [...(problem.tags ?? [])],
  })),
  rows: standings.rows.map((row) => ({
    ...row,
    party: {
      ...row.party,
      contestId: row.party.contestId ?? standings.contest.id,
      teamId: row.party.teamId,
      teamName: row.party.teamName,
      ghost: row.party.ghost ?? false,
      room: row.party.room,
      startTimeSeconds: row.party.startTimeSeconds,
      rank: row.rank,
      members: row.party.members.map((member) => ({ ...member, name: member.name ?? '' })),
    },
    problemResults: row.problemResults.map((result) => ({ ...result })),
  })),
});

export const mapUserDto = (user: CodeforcesUserDto): User => ({
  handle: user.handle,
  rank: user.rank ?? 'unrated',
});
