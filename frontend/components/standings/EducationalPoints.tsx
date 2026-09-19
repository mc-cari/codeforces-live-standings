import React from 'react';

export default function EducationalPoints({ numProblemsSolved, penalty } :
{ numProblemsSolved: number, penalty: number }) {
  return (
    <>
      <div className="flex-1 text-xl flex items-center justify-center">
        {numProblemsSolved}
      </div>
      <div className="flex-1 text-base flex items-center justify-center">{penalty}</div>
    </>
  );
}
