import React from 'react';
import LiveSubmission from './LiveSubmission';

export default function LiveSubmissionsList({
  submissions, newSubmissionsCount, globalStandings, userRank,
} :
{ submissions : Submission[], newSubmissionsCount : number, globalStandings : Standings | undefined,
  userRank : Map<string, string> }) {
  return (
    <div className="flex flex-col-reverse overflow-y-auto scrollbar-hide h-full w-full">
      {submissions.map((submission : Submission, index : number) => (
        <div key={submission.id} className="h-8">
          <LiveSubmission
            submission={submission}
            isNew={index < newSubmissionsCount}
            userCount={globalStandings?.rows.length as number}
            userRank={userRank}
          />
        </div>
      ))}
    </div>
  );
}
