import React from 'react';

export default function ProblemStatusEdu({ problem } : { problem : ProblemResult }) {
  return (
    <div className="h-full">
      {(problem.points > 0 || problem.rejectedAttemptCount > 0)
        && (
        <div className={`flex flex-col items-center text-xl justify-center py-1 h-full 
        bg-${problem.points > 0 ? 'green-500' : 'red-500'}`}
        >
          {problem.points > 0
            ? `+${problem.rejectedAttemptCount > 0 ? problem.rejectedAttemptCount : ''}`
            : `-${problem.rejectedAttemptCount.toString()}`}
        </div>
        )}
    </div>
  );
}
