import React from 'react';

export default function UpcomingContestsLoading() {
  return (
    <section
      className="max-w-6xl mx-auto mt-12 text-left"
      aria-labelledby="upcoming-contests-loading-title"
      aria-busy="true"
    >
      <div className="flex items-center gap-4 mb-4">
        <h2
          id="upcoming-contests-loading-title"
          className="font-mono text-xs tracking-[0.2em] text-blue-300 uppercase"
        >
          Upcoming contests
        </h2>
        <div className="h-px grow bg-blue-400/20" />
      </div>
      <div
        className={
          'relative flex items-center gap-4 p-5 overflow-hidden border '
          + 'border-blue-400/20 rounded-xl bg-gray-950/60'
        }
        role="status"
      >
        <div className="absolute inset-y-0 left-0 w-1 bg-blue-400/60 motion-safe:animate-pulse" />
        <div
          className={
            'w-9 h-9 border-2 rounded-full shrink-0 border-blue-300/20 '
            + 'border-t-blue-300 motion-safe:animate-spin'
          }
          aria-hidden="true"
        />
        <div>
          <p className="font-medium text-white">Checking the Codeforces schedule…</p>
          <p className="mt-1 text-sm text-gray-400">
            Upcoming contests will appear here when the schedule is ready.
          </p>
        </div>
      </div>
    </section>
  );
}
