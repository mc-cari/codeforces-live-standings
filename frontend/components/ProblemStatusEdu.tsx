import React from 'react';
import type { ProblemResult } from '@/src/shared/domain/contest';

export default function ProblemStatusEdu({ problem } : { problem : ProblemResult }) {
  return (
    <div className="h-full">
      {(problem.points > 0 || problem.rejectedAttemptCount > 0)
        && (
        <div className={`flex h-full flex-col items-center justify-center py-1 text-xl ${
          problem.points > 0 ? 'bg-[#21c16b] text-[#03170d]' : 'bg-[#eb5757] text-white'
        }`}
        >
          {problem.points > 0
            ? `+${problem.rejectedAttemptCount > 0 ? problem.rejectedAttemptCount : ''}`
            : `-${problem.rejectedAttemptCount.toString()}`}
        </div>
        )}
    </div>
  );
}
