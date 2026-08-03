import React, { useEffect, useState } from 'react';
import { formatCountdown, secondsUntilContest } from '../utils/contestConfiguration';

type UpcomingContestProps = {
  contests: Contest[];
  onSelect: (contest: Contest) => void;
};

const formatStartTime = (startTimeSeconds: number) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(startTimeSeconds * 1_000));

export default function UpcomingContest({ contests = [], onSelect }: UpcomingContestProps) {
  const [nowMilliseconds, setNowMilliseconds] = useState(Date.now);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMilliseconds(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const displayedContests = contests.filter(
    (contest) => contest.phase === 'CODING'
      || secondsUntilContest(contest, nowMilliseconds) > 0,
  );
  if (displayedContests.length === 0) return null;

  const hasLiveContest = displayedContests.some((contest) => contest.phase === 'CODING');

  return (
    <section
      className="max-w-6xl mx-auto mt-12 text-left"
      aria-labelledby="upcoming-contests-title"
    >
      <div className="flex items-center gap-4 mb-4">
        <h2
          id="upcoming-contests-title"
          className="font-mono text-xs tracking-[0.2em] text-blue-300 uppercase"
        >
          {hasLiveContest ? 'Live & upcoming contests' : 'Upcoming contests'}
        </h2>
        <div className="h-px grow bg-blue-400/20" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {displayedContests.map((contest, index) => {
          const isLive = contest.phase === 'CODING';

          return (
            <article
              key={contest.id}
              className={
                'relative flex flex-col min-w-0 p-5 overflow-hidden border '
                + `${isLive ? 'border-emerald-400/40' : 'border-blue-400/30'} `
                + 'rounded-xl bg-gray-950/80 shadow-xl shadow-blue-950/20'
              }
            >
              <div
                className={
                  `absolute inset-y-0 left-0 w-1 ${isLive ? 'bg-emerald-400' : 'bg-blue-400'}`
                }
              />
              <p
                className={
                  'mb-2 font-mono text-xs tracking-[0.18em] uppercase '
                  + (isLive ? 'text-emerald-300' : 'text-blue-300')
                }
              >
                {String(index + 1).padStart(2, '0')}
                {' · '}
                {isLive ? 'Live now · ' : ''}
                Contest #{contest.id}
              </p>
              <h3 className="text-lg font-semibold leading-snug text-white grow">
                {contest.name}
              </h3>
              <p className="mt-3 text-sm text-gray-400">
                {isLive ? 'Started ' : ''}
                {formatStartTime(contest.startTimeSeconds)}
              </p>
              <div className="flex items-end justify-between gap-3 pt-4 mt-4 border-t border-gray-800">
                <div>
                  <p className="mb-1 text-[0.65rem] font-medium tracking-wider text-gray-500 uppercase">
                    {isLive ? 'Status' : 'Starts in'}
                  </p>
                  <p
                    className={
                      'font-mono text-xl font-semibold tabular-nums '
                      + (isLive ? 'text-emerald-300' : 'text-blue-300')
                    }
                  >
                    {isLive
                      ? 'In progress'
                      : formatCountdown(secondsUntilContest(contest, nowMilliseconds))}
                  </p>
                </div>
                <button
                  className={
                    'text-sm font-semibold text-white underline decoration-blue-400 '
                    + 'underline-offset-4 transition-colors hover:text-blue-300 '
                    + 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 '
                    + 'focus-visible:outline-blue-400'
                  }
                  onClick={() => onSelect(contest)}
                  type="button"
                >
                  Set up
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
