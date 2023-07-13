import React from 'react';
import NormalPointsHeader from './NormalPointsHeader';
import EducationalPointsHeader from './EducationalPointsHeader';

export default function Header({
  globalStandings, contestType,
} : { globalStandings: Standings, contestType: string }) {
  return (
    <div className="flex flex-row h-14 w-full">
      <div className="bg-red-500 w-1/3 text-lg px-1 flex items-center justify-center">CURRENT STANDINGS</div>

      {contestType === 'normal' ? <NormalPointsHeader /> : <EducationalPointsHeader /> }

      {globalStandings.problems.map((problem) => (
        <div className="flex-1 text-xl flex items-center justify-center" key={problem.index}>{problem.index}</div>
      ))}
    </div>
  );
}
