import React from 'react';
import Veredict from './Veredict';

export default function Submission({ submission } : { submission: Submission }) {
  const submissionUrl = `https://codeforces.com/contest/${submission.contestId}/submission/${submission.id}`;

  return (
    <div className="flex flox-row m-2 border-solid border-2 border-sky-500">
      <a href={submissionUrl} target="_blank" rel="noopener noreferrer" className="no-underline">
        Id:
        {submission.id}
      </a>
      <p>
        Index:
        {submission.problem.index}
      </p>
      <p>
        Author:
        {submission.author.members[0].handle}
      </p>
      <Veredict veredict={submission.verdict} test={submission.passedTestCount} />
      <p>
        Test Count:
        {submission.passedTestCount}
      </p>
      <p>
        Time:
        {submission.timeConsumedMillis}
      </p>
      <p>
        TimeSubmit:
        {submission.creationTimeSeconds}
      </p>
    </div>
  );
}
