import React, { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cellKey } from '@/src/shared/freeze/projection';
import type { Standings } from '@/src/shared/domain/contest';
import ProblemStatusEdu from '../ProblemStatusEdu';
import ProblemStatusNormal from '../ProblemStatusNormal';
import Position from '../Position';
import getName from '@/src/shared/domain/party';
import UserHandle from '../UserHandle';
import Header from './Header';
import NormalPoints from './NormalPoints';
import EducationalPoints from './EducationalPoints';

export default function StandingsList({
  localStandings, globalStandings, contestType, userRank, pending, focused, isVisible = true,
} :
{ localStandings: Map<string, number>, globalStandings: Standings, contestType: string,
  userRank: Map<string, string>, pending?: Map<string, number>, focused?: string, isVisible?: boolean }) {
  const reduced = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Measure after row movement so the focused cell is scrolled to its new position.
    if (!isVisible) return undefined;
    const timer = window.setTimeout(() => {
      const element = Array.from(panel.current?.querySelectorAll<HTMLElement>('[data-freeze-cell]') || [])
        .find((cell) => cell.dataset.freezeCell === focused);
      const scroller = panel.current;
      if (element && scroller) {
        const bounds = element.getBoundingClientRect();
        const container = scroller.getBoundingClientRect();
        if (bounds.top < container.top || bounds.bottom > container.bottom) {
          scroller.scrollTo({
            top: scroller.scrollTop + bounds.top - container.top - container.height / 2,
            behavior: reduced ? 'instant' : 'smooth',
          });
        }
      }
    }, reduced ? 0 : 450);
    return () => window.clearTimeout(timer);
  }, [focused, reduced, isVisible]);
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

      <div ref={panel} className="flex min-h-0 flex-col grow w-full overflow-y-auto scrollbar-hide">
        {globalStandings.rows.map((row) => (
          <motion.div
            layout={reduced ? false : 'position'}
            transition={{ duration: reduced ? 0 : 0.45, ease: 'easeOut' }}
            data-standings-row={getName(row.party)}
            className="flex min-w-0 shrink-0 flex-row h-12 w-full hover:bg-gray-800/40 transition-colors border-b border-gray-800/50"
            key={getName(row.party)}
          >
            <div className="flex min-w-0 flex-row w-1/3">
              <div className="w-1/5 shrink-0 text-xl">
                <Position
                  position={localStandings.get(getName(row.party)) as number}
                  userCount={globalStandings.rows.length}
                />
              </div>

              <div className="flex min-w-0 w-4/5 items-center overflow-hidden px-3 py-1 text-lg">
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

            {row.problemResults.map((problem, index) => {
              const key = cellKey(getName(row.party), globalStandings.problems[index].index);
              const count = pending?.get(key);
              return (
                <div
                  data-freeze-cell={key}
                  className={`flex-1 h-full ${focused === key ? 'relative z-10 outline-2 -outline-offset-2 outline-[#f3b83f]' : ''}`}
                  key={key}
                >
                  {count ? (
                    <div
                      className="relative h-full shadow-[inset_0_0_0_2px_#f3b83f]"
                    >
                      <div className="h-full">
                        {contestType === 'normal' ? <ProblemStatusNormal problem={problem} />
                          : <ProblemStatusEdu problem={problem} />}
                      </div>
                      <span
                        className="absolute right-0 top-0 z-10 bg-[#3b2c0d] px-1.5 font-data text-xs leading-5 text-[#ffe8a3]"
                        aria-label={`${count} pending submissions`}
                      >? {count}</span>
                    </div>
                  ) : (
                    <motion.div
                      key={`${problem.points}/${problem.rejectedAttemptCount}`}
                      initial={{ opacity: reduced ? 1 : 0.3 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: reduced ? 0 : 0.3 }}
                      className="h-full"
                    >
                      {contestType === 'normal' ? <ProblemStatusNormal problem={problem} />
                        : <ProblemStatusEdu problem={problem} />}
                    </motion.div>
                  )}
                </div>
              );
            })}
          </motion.div>

        ))}
      </div>

    </div>
  );
}
