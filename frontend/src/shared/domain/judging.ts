type JudgedSubmission = {
  relativeTimeSeconds: number;
  author: { participantType: string };
  verdict?: string;
};

export const hasPendingContestJudging = (submissions: JudgedSubmission[], duration: number) =>
  submissions.some((submission) => submission.author.participantType !== 'PRACTICE'
    && submission.relativeTimeSeconds >= 0 && submission.relativeTimeSeconds <= duration
    && (!submission.verdict || submission.verdict === 'SUBMITTED' || submission.verdict === 'TESTING'));
