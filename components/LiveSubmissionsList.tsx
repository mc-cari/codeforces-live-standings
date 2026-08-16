import React from 'react';
import type { Standings, Submission } from '@/src/shared/domain/contest';
import { AnimatePresence, motion } from 'framer-motion';
import LiveSubmission from './LiveSubmission';

export default function LiveSubmissionsList({
  submissions, newSubmissionsCount, globalStandings, userRank,
} :
{ submissions : Submission[], newSubmissionsCount : number,
  globalStandings : Standings | undefined,
  userRank : Map<string, string> }) {
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
      <div className="flex flex-col-reverse overflow-y-auto scrollbar-hide flex-grow">
        <AnimatePresence initial={false}>
          {submissions.map((submission : Submission, index : number) => (
            <motion.div
              layout="position"
              initial={{ opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.36, ease: 'easeOut' }}
              className="h-8"
            key={submission.id}
            >
              <LiveSubmission
                submission={submission}
                isNew={index < newSubmissionsCount}
                userCount={globalStandings?.rows.length as number}
                userRank={userRank}
                isGym={globalStandings?.contest.type === 'GYM'}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
