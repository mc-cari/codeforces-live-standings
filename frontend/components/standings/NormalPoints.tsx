import React from 'react';

export default function NormalPoints({ numProblemsSolved, points } :
{ numProblemsSolved: number, points: number }) {
  return (
    <>
      <div className="flex-1 text-base flex items-center justify-center">{points}</div>
      <div className="flex-1 text-xl flex items-center justify-center">
        {numProblemsSolved}
      </div>
    </>
  );
}
