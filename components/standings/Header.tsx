import React from 'react';
import NormalPointsHeader from './NormalPointsHeader';
import EducationalPointsHeader from './EducationalPointsHeader';

export default function Header({
  globalStandings, contestType,
} : { globalStandings: Standings, contestType: string }) {
  return (
    <div className="flex flex-row h-14 w-full border-b-2 border-gray-800">
      <div
        className={
          'bg-gradient-to-r from-red-600 to-red-500 w-1/3 text-lg px-1 flex '
          + 'items-center justify-center font-semibold tracking-wide shadow-lg'
        }
      >
        CURRENT STANDINGS
      </div>

      {contestType === 'normal' ? <NormalPointsHeader /> : <EducationalPointsHeader /> }

      {globalStandings.problems.map((problem) => (
        <div
          className={
            'flex-1 text-xl flex items-center justify-center font-semibold '
            + 'bg-gray-800/30 hover:bg-gray-700/30 transition-colors'
          }
          key={problem.index}
        >
          {problem.index}
        </div>
      ))}
    </div>
  );
}
