import React from 'react';
import Veredict from './Veredict';
import Position from './Position';
import UserHandle from './UserHandle';

export default function LiveSubmission({
  submission, isNew, userCount, userRank,
}
: { submission: Submission, isNew : boolean, userCount : number,
  userRank : Map<string, string> }) {
  return (
    <div
      className={`h-full flex flex-row border-b border-gray-800/30 hover:bg-gray-800/30 transition-all ${
        isNew || submission.verdict === 'TESTING' ? 'animate-pulse bg-blue-900/20' : ''
      }`}
    >
      <div className="w-1/12 text-xl">
        <Position
          position={submission.author.rank}
          userCount={userCount}
        />
      </div>

      <div className="grow flex items-center text-lg p-2">
        <UserHandle author={submission.author} userRank={userRank} />
      </div>
      <div className="w-1/12 flex items-center justify-center text-lg font-semibold">
        {submission.numberOfProblems}
      </div>
      <div className="w-1/12 flex items-center justify-center text-xl font-bold">
        {submission.problem.index}
      </div>
      <div className="w-1/12 text-xl">
        <Veredict veredict={submission.verdict} test={submission.passedTestCount} />
      </div>
    </div>
  );
}
