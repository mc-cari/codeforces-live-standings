import type { Party, Standings, Submission } from '../../../shared/domain/contest.ts';
import { MAX_SUBMISSIONS_IN_MEMORY } from '../../../shared/config/contestTiming.ts';
import getName from '../../../shared/domain/party.ts';
import { participantIdentity } from '../../../shared/domain/participantHandles.ts';
import { addMissingParticipantRows } from '../../../shared/domain/standings.ts';

export type LiveProjection = {
  standings: Standings;
  localStandings: Map<string, number>;
  submissions: Submission[];
  newSubmissionCount: number;
  isFinished: boolean;
};

const hasSelectedMember = (party: Party, selected: Set<string>) => (
  party.members.some((member) => selected.has(participantIdentity(member.handle)))
);

const calculateLocalStandings = (
  standings: Standings,
  handles: string[],
) => {
  const positions = new Map(handles.map((handle) => [handle, handles.length]));
  let previousPoints = Number.NaN;
  let previousPenalty = Number.NaN;
  let previousPosition = 0;
  const positioned = new Set<string>();

  standings.rows.forEach((row, index) => {
    const position = row.points === previousPoints && row.penalty === previousPenalty
      ? previousPosition : index + 1;
    const name = getName(row.party);
    const identity = participantIdentity(name);
    if (!positioned.has(identity)) {
      positions.set(name, position);
      positioned.add(identity);
    }
    previousPoints = row.points;
    previousPenalty = row.penalty;
    previousPosition = position;
  });
  return positions;
};

export const projectLiveUpdate = (
  officialStandings: Standings,
  remoteSubmissions: Submission[],
  previousSubmissions: Submission[],
  selectedHandles: string[],
): LiveProjection => {
  const selected = new Set(selectedHandles.map(participantIdentity));
  const selectedRemote = remoteSubmissions.filter((submission) => (
    hasSelectedMember(submission.author, selected)
  ));
  const filteredStandings = {
    ...officialStandings,
    rows: officialStandings.rows.filter((row) => hasSelectedMember(row.party, selected)),
  };
  const standings = addMissingParticipantRows(filteredStandings, selectedRemote, getName);
  const localStandings = calculateLocalStandings(standings, selectedHandles);
  const previousIds = new Set(previousSubmissions.map((submission) => submission.id));
  const submissionsById = new Map<number, Submission>();

  previousSubmissions.forEach((submission) => submissionsById.set(submission.id, submission));
  selectedRemote.forEach((submission) => submissionsById.set(submission.id, submission));

  const solvedProblems = new Map<string, Set<string>>();
  const submissions = Array.from(submissionsById.values())
    .sort((first, second) => (
      first.relativeTimeSeconds - second.relativeTimeSeconds || first.id - second.id
    ))
    .map((submission) => {
      const name = getName(submission.author);
      const solved = solvedProblems.get(name) || new Set<string>();
      if (submission.verdict === 'OK') solved.add(submission.problem.index);
      solvedProblems.set(name, solved);
      return {
        ...submission,
        author: {
          ...submission.author,
          members: [...submission.author.members],
          rank: localStandings.get(name) ?? selectedHandles.length,
        },
        numberOfProblems: solved.size,
      };
    })
    .reverse()
    .slice(0, MAX_SUBMISSIONS_IN_MEMORY);

  const newSubmissionCount = submissions.filter((submission) => !previousIds.has(submission.id)).length;

  return {
    standings,
    localStandings,
    submissions,
    newSubmissionCount,
    isFinished: standings.contest.phase === 'FINISHED',
  };
};
