import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import LiveSubmission from './LiveSubmission';

export default function LiveSubmissionsList({
  submissions, newSubmissionsCount, globalStandings, userRank,
} :
{ submissions : Submission[], newSubmissionsCount : number, globalStandings : Standings | undefined,
  userRank : Map<string, string> }) {
  return (
    <div className="flex flex-col h-full w-full">
      <div
        className={
          'h-14 bg-gradient-to-r from-blue-600 to-blue-500 flex items-center '
          + 'justify-center font-semibold text-lg tracking-wide border-b-2 '
          + 'border-gray-800 shadow-lg'
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
