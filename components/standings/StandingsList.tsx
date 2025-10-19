import React from 'react';
import ProblemStatusEdu from '../ProblemStatusEdu';
import ProblemStatusNormal from '../ProblemStatusNormal';
import Position from '../Position';
import getName from '../../utils/getName';
import UserHandle from '../UserHandle';
import Header from './Header';
import NormalPoints from './NormalPoints';
import EducationalPoints from './EducationalPoints';

export default function StandingsList({
  localStandings, globalStandings, contestType, userRank,
} :
{ localStandings: Map<string, number>, globalStandings: Standings, contestType: string,
  userRank: Map<string, string> }) {
  const problemsSolved : Map<string, number> = new Map<string, number>();

  globalStandings.rows.forEach((row) => {
    let solved = 0;
    row.problemResults.forEach((problem) => {
      if (problem.points > 0) solved += 1;
    });
    problemsSolved.set(getName(row.party), solved);
  });

  return (
    <div className="flex flex-col h-full w-full">

      <Header globalStandings={globalStandings} contestType={contestType} />

      <div className="flex flex-col grow w-full overflow-y-auto scrollbar-hide">
        {globalStandings.rows.map((row) => (
          <div
            className="flex flex-row h-12 w-full hover:bg-gray-800/40 transition-colors border-b border-gray-800/50"
            key={getName(row.party)}
          >
            <div className="flex flex-row w-1/3">
              <div className="w-1/5 text-xl">
                <Position
                  position={localStandings.get(getName(row.party)) as number}
                  userCount={globalStandings.rows.length}
                />
              </div>

              <div className="w-4/5 text-lg flex items-center px-3 py-1">
                <UserHandle author={row.party} userRank={userRank} />
              </div>
            </div>

            {contestType === 'normal'
              ? (
                <NormalPoints
                  numProblemsSolved={problemsSolved.get(getName(row.party)) as number}
                  points={row.points}
                />
              )
              : (
                <EducationalPoints
                  numProblemsSolved={problemsSolved.get(getName(row.party)) as number}
                  penalty={row.penalty}
                />
              )}

            {row.problemResults.map((problem, index) => (
              <div
                className="flex-1 h-full"
                key={getName(row.party) + index.toString()}
              >
                {contestType === 'normal' ? <ProblemStatusNormal problem={problem} />
                  : <ProblemStatusEdu problem={problem} />}
              </div>
            ))}
          </div>

        ))}
      </div>

    </div>
  );
}
