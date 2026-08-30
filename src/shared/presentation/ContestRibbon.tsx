import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

type ContestRibbonContest = {
  name: string;
  durationSeconds: number;
  startTimeSeconds: number;
};

type ContestRibbonProps = {
  contest?: ContestRibbonContest;
  contestId: string;
  mode: 'LIVE' | 'REPLAY';
  clock?: string;
  status?: string;
  statusTone?: 'live' | 'paused' | 'finished';
  controls?: ReactNode;
};

const formatClock = (seconds: number) => {
  const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${remainder}`;
};

export default function ContestRibbon({
  contest,
  contestId,
  mode,
  clock,
  status,
  statusTone = 'live',
  controls,
}: ContestRibbonProps) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (clock) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [clock]);

  const elapsedSeconds = contest
    ? Math.max(0, Math.min(
      contest.durationSeconds,
      Math.floor(now / 1_000) - contest.startTimeSeconds,
    )) : 0;
  const tone = {
    live: 'bg-[#21c16b]',
    paused: 'bg-[#f3b83f]',
    finished: 'bg-[#91a3ba]',
  }[statusTone];

  return (
    <header className="border-b border-[#25364d] bg-[#07111f]" data-testid="contest-ribbon">
      <div className="mx-auto flex min-h-16 max-w-[1600px] flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2 sm:px-5">
        <Link className="font-broadcast text-lg font-bold uppercase tracking-[0.08em]" href="/">
          CF <span className="text-[#65adff]">Live Standings</span>
        </Link>
        <div className="hidden h-8 w-px bg-[#25364d] sm:block" />
        <div className="min-w-0 grow">
          <h1 className="text-xl font-semibold tracking-wide uppercase truncate font-broadcast sm:text-2xl">
            {contest?.name || `Codeforces ${contestId}`}
          </h1>
        </div>
        <div className="flex items-center gap-2 rounded-sm border border-[#25364d] bg-[#0d1b2a] px-3 py-2">
          <span className={`h-2 w-2 rounded-full ${tone} ${statusTone === 'live' ? 'animate-pulse' : ''}`} />
          <div className={status ? undefined : 'flex items-center'}>
            <p className="leading-none broadcast-label">{mode}</p>
            {status && <p className="mt-1 text-xs font-semibold text-white">{status}</p>}
          </div>
        </div>
        <div className="text-right min-w-28">
          <p className="broadcast-label">Contest time</p>
          <p className="text-lg text-white font-data">{clock || formatClock(elapsedSeconds)}</p>
        </div>
        {controls && <div className="flex items-center gap-2">{controls}</div>}
      </div>
    </header>
  );
}
