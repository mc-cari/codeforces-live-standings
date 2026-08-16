import React from 'react';
import type { ProblemResult } from '@/src/shared/domain/contest';

export default function ProblemStatusNormal({ problem } : { problem : ProblemResult }) {
  return (
    <div className="h-full">
      {(problem.points > 0 || problem.rejectedAttemptCount > 0)
        && (
        <div className={`flex h-full flex-col items-center justify-center py-1 ${
          problem.points > 0 ? 'bg-[#21c16b] text-[#03170d]' : 'bg-[#eb5757] text-white'
        }`}
        >
          <div className="h-2/3 flex items-center justify-center">
            {problem.points > 0 ? problem.points : '0'}
          </div>
          <div className="h-1/3 text-xs flex items-center justify-center">
            {problem.rejectedAttemptCount + Number(problem.points > 0) === 1 ? '1 try'
              : `${problem.rejectedAttemptCount + Number(problem.points > 0)} tries`}
          </div>
        </div>
        )}
    </div>
  );
}
