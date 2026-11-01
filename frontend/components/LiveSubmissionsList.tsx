import { hackPoints, type Hack } from '@/src/shared/domain/hacks';
import { MAX_SUBMISSIONS_IN_MEMORY } from '@/src/shared/config/contestTiming';
import UserHandle from './UserHandle';
import React from 'react';
import type { Standings, Submission } from '@/src/shared/domain/contest';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import LiveSubmission from './LiveSubmission';

export default function LiveSubmissionsList({
  submissions, newSubmissionsCount, globalStandings, userRank, hacks = [], hacksIncomplete = false, retryHacks, hacksLoading = false, focused = '',
} :
{ hacks?: Hack[]; hacksIncomplete?: boolean; retryHacks?: () => void; hacksLoading?: boolean;
  focused?: string; submissions : Submission[], newSubmissionsCount : number,
  globalStandings : Standings | undefined,
  userRank : Map<string, string> }) {
  const reduced = useReducedMotion();
  const entries = [
    ...submissions.map((submission) => ({ kind: 'submission' as const, key: `submission:${submission.id}`, time: submission.creationTimeSeconds, submission })),
    ...hacks.map((hack) => ({ kind: 'hack' as const, key: `hack:${hack.id}`, time: hack.creationTimeSeconds, hack })),
  ].sort((a, b) => b.time - a.time || b.key.localeCompare(a.key)).slice(0, MAX_SUBMISSIONS_IN_MEMORY);
  return (
    <div className="flex flex-col h-full w-full">
      <div
        className={
          'flex h-14 items-center justify-center border-b border-[#25364d] '
          + 'bg-[#103c68] font-broadcast text-xl font-semibold tracking-[0.08em]'
        }
      >
        LIVE SUBMISSIONS
      </div>
      {hacksIncomplete && <div role="status" className="flex items-center justify-between gap-2 border-b border-[#25364d] px-3 py-2 text-sm text-[#ffe8a3]">
        <span>Hack details may be incomplete</span>
        {retryHacks && <button type="button" onClick={retryHacks} disabled={hacksLoading} className="min-h-11 px-2 underline focus-visible:outline-2">{hacksLoading ? 'Loading…' : 'Retry'}</button>}
      </div>}
      <div className="flex flex-col-reverse overflow-y-auto scrollbar-hide flex-grow">
        <AnimatePresence initial={false}>
          {entries.map((entry, index) => (
            <motion.div
              layout={reduced ? false : "position"}
              initial={reduced ? false : { opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: reduced ? 0 : 0.36, ease: 'easeOut' }}
              className={entry.kind === 'hack' ? 'min-h-16 shrink-0' : 'h-8 shrink-0'}
            key={entry.key}
              data-feed-key={entry.key}
            >
              {entry.kind === 'hack' ? <div
                data-hack-id={entry.hack.id}
                className={`flex h-full min-w-0 flex-wrap items-center gap-x-2 border-b border-gray-800/30 px-2 py-1 text-sm ${focused === entry.key ? 'bg-[#594314]' : ''}`}
              >
                <span className="font-semibold text-[#91a3ba]">Hack</span>
                <div className="min-w-0 max-w-[35%]"><UserHandle author={entry.hack.hacker} userRank={userRank} /></div>
                <span className="text-[#91a3ba]">against</span>
                <div className="min-w-0 max-w-[35%]"><UserHandle author={entry.hack.defender} userRank={userRank} /></div>
                <span className="font-semibold">{entry.hack.problem.index}</span>
                <span className="text-[#c8d8ea]">{entry.hack.verdict === 'HACK_SUCCESSFUL' ? 'Successful' : entry.hack.verdict === 'HACK_UNSUCCESSFUL' ? 'Unsuccessful' : entry.hack.verdict.replaceAll('_', ' ').toLowerCase()}</span>
                {hackPoints(globalStandings?.contest.type || '', entry.hack.verdict) !== 0 && <span className="font-data text-[#ffe8a3]">{hackPoints(globalStandings?.contest.type || '', entry.hack.verdict) > 0 ? '+' : ''}{hackPoints(globalStandings?.contest.type || '', entry.hack.verdict)}</span>}
                {entry.hack.creationTimeSeconds - (globalStandings?.contest.startTimeSeconds || 0) > (globalStandings?.contest.durationSeconds || 0) && <span className="text-[#91a3ba]">After contest</span>}
              </div> : <LiveSubmission
                submission={entry.submission}
                isNew={index < newSubmissionsCount}
                userCount={globalStandings?.rows.length as number}
                userRank={userRank}
                isGym={globalStandings?.contest.type === 'GYM'}
              />}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
