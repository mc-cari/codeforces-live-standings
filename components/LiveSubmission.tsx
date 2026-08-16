import React from 'react';
import type { Submission } from '@/src/shared/domain/contest';
import Veredict from './Veredict';
import Position from './Position';
import UserHandle from './UserHandle';

export default function LiveSubmission({
  submission, isNew, userCount, userRank, isGym, compact = false,
}
: { submission: Submission, isNew : boolean, userCount : number,
  userRank : Map<string, string>, isGym: boolean, compact?: boolean }) {
  const submissionUrl = `https://codeforces.com/${isGym ? 'gym' : 'contest'}/${submission.contestId}`
    + `/submission/${submission.id}`;
  const problemUrl = `https://codeforces.com/${isGym ? 'gym' : 'contest'}/${submission.contestId}`
    + `/problem/${submission.problem.index}`;

  return (
    <div
      className={`${compact
        ? 'relative grid min-w-0 h-full grid-cols-[2rem_minmax(7rem,1fr)_3rem_3rem_3rem] border-b border-gray-800/30'
        : 'relative flex min-w-0 h-full flex-row border-b border-gray-800/30'} hover:bg-gray-800/30 transition-all ${
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
      <div className={compact ? 'text-xl' : 'w-1/12 text-xl'}>
        <Position
          position={submission.author.rank}
          userCount={userCount}
        />
      </div>

      <div className="relative z-10 min-w-0 flex items-center p-2 text-lg">
        <UserHandle author={submission.author} userRank={userRank} />
      </div>
      <div className={compact
        ? 'flex items-center justify-center text-sm font-semibold'
        : 'w-1/12 flex items-center justify-center text-lg font-semibold'}>
        {submission.numberOfProblems}
      </div>
      <div className={compact
        ? 'flex items-center justify-center text-lg font-bold'
        : 'w-1/12 flex items-center justify-center text-xl font-bold'}>
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
      <div className={compact ? 'text-lg' : 'w-1/12 text-xl'}>
        <Veredict veredict={submission.verdict} test={submission.passedTestCount} />
      </div>
    </div>
  );
}
