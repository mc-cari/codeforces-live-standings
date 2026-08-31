import React, { useEffect, useState } from 'react';
import type { CodeforcesContestDto } from '@/src/integrations/codeforces/contracts';
import {
  formatCountdown,
  secondsUntilContest,
} from '@/src/contexts/contest-setup/domain/contestConfiguration';

type ContestCountdownProps = {
  contest: CodeforcesContestDto;
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
    <main className="flex items-center justify-center min-h-screen px-6 text-white bg-black">
      <section
        className={
          'w-full max-w-2xl p-10 text-center border border-gray-700 '
          + 'shadow-2xl rounded-2xl bg-gray-900/80'
        }
      >
        <h1 className="mb-6 text-3xl font-bold">{contest.name}</h1>
        <p className="mb-3 text-sm font-medium tracking-widest text-blue-300 uppercase">
          Contest starts in
        </p>
        <div className="font-mono text-5xl font-semibold tracking-tight text-white sm:text-7xl">
          {formatCountdown(remainingSeconds)}
        </div>
      </section>
    </main>
  );
}
