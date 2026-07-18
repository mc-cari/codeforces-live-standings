import React from 'react';
import Veredict from './Veredict';
import Position from './Position';
import UserHandle from './UserHandle';

export default function LiveSubmission({
  submission, isNew, userCount, userRank, isGym,
}
: { submission: Submission, isNew : boolean, userCount : number,
  userRank : Map<string, string>, isGym: boolean }) {
  const submissionUrl = `https://codeforces.com/${isGym ? 'gym' : 'contest'}/${submission.contestId}`
    + `/submission/${submission.id}`;
  const problemUrl = `https://codeforces.com/${isGym ? 'gym' : 'contest'}/${submission.contestId}`
    + `/problem/${submission.problem.index}`;

  return (
    <div
      className={`relative h-full flex flex-row border-b border-gray-800/30 hover:bg-gray-800/30 transition-all ${
        isNew || submission.verdict === 'TESTING' ? 'animate-pulse bg-blue-900/20' : ''
      }`}
    >
      <a
        href={submissionUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open submission ${submission.id}`}
        className="absolute inset-0 z-0"
      />
      <div className="w-1/12 text-xl">
        <Position
          position={submission.author.rank}
          userCount={userCount}
        />
      </div>

      <div className="relative z-10 grow flex items-center text-lg p-2">
        <UserHandle author={submission.author} userRank={userRank} />
      </div>
      <div className="w-1/12 flex items-center justify-center text-lg font-semibold">
        {submission.numberOfProblems}
      </div>
      <div className="w-1/12 flex items-center justify-center text-xl font-bold">
        <a
          href={problemUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="relative z-10"
          aria-label={`Open problem ${submission.problem.index}`}
        >
          {submission.problem.index}
        </a>
      </div>
      <div className="w-1/12 text-xl">
        <Veredict veredict={submission.verdict} test={submission.passedTestCount} />
      </div>
    </div>
  );
}
