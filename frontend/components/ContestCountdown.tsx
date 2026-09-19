import React, { useEffect, useState } from 'react';
import type { Contest } from '@/src/shared/domain/contest';
import {
  formatCountdown,
  secondsUntilContest,
} from '@/src/contexts/contest-setup/domain/contestConfiguration';

type ContestCountdownProps = {
  contest: Contest;
  onComplete: () => void;
};

export default function ContestCountdown({ contest, onComplete }: ContestCountdownProps) {
  const [remainingSeconds, setRemainingSeconds] = useState(() => secondsUntilContest(contest));

  useEffect(() => {
    const update = () => {
      const remaining = secondsUntilContest(contest);
      setRemainingSeconds(remaining);
      if (remaining === 0) onComplete();
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [contest, onComplete]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#07111f] px-6 text-white">
      <section
        className={
          'broadcast-panel w-full max-w-2xl rounded-sm p-10 text-center'
        }
      >
        <h1 className="mb-8 text-4xl font-semibold uppercase font-broadcast">{contest.name}</h1>
        <p className="mb-3 text-sm font-medium uppercase tracking-widest text-[#9fc8ff]">
          Contest starts in
        </p>
        <div className="text-5xl font-semibold tracking-tight text-white font-data sm:text-7xl">
          {formatCountdown(remainingSeconds)}
        </div>
      </section>
    </main>
  );
}
