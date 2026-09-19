import React from 'react';
import type { Standings } from '@/src/shared/domain/contest';
import NormalPointsHeader from './NormalPointsHeader';
import EducationalPointsHeader from './EducationalPointsHeader';

export default function Header({
  globalStandings, contestType,
} : { globalStandings: Standings, contestType: string }) {
  return (
    <div className="flex h-14 w-full flex-row border-b border-[#25364d] bg-[#13243a]">
      <div
        className={
          'flex w-1/3 items-center justify-center bg-[#7d2633] px-1 font-broadcast '
          + 'text-xl font-semibold tracking-[0.08em]'
        }
      >
        CURRENT STANDINGS
      </div>

      {contestType === 'normal' ? <NormalPointsHeader /> : <EducationalPointsHeader /> }

      {globalStandings.problems.map((problem) => (
        <a
          href={`https://codeforces.com/contest/${globalStandings.contest.id}/problem/${problem.index}`}
          target="_blank"
          rel="noopener noreferrer"
          className={
            'flex-1 text-xl flex items-center justify-center font-semibold '
            + 'bg-[#13243a] hover:bg-[#1b304a] transition-colors'
          }
          key={problem.index}
          aria-label={`Open problem ${problem.index}: ${problem.name}`}
        >
          {problem.index}
        </a>
      ))}
    </div>
  );
}
