import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

const DURATION_SECONDS = 28;
const participants = ['bytebloom', 'dp_dreamer', 'greedyfox', 'stacktrace'];
const problems = ['A', 'B', 'C', 'D'];
const events = [
  { second: 2, handle: 'greedyfox', problem: 'A', verdict: 'rejected' },
  { second: 5, handle: 'bytebloom', problem: 'A', verdict: 'accepted' },
  { second: 8, handle: 'stacktrace', problem: 'B', verdict: 'accepted' },
  { second: 12, handle: 'greedyfox', problem: 'A', verdict: 'accepted' },
  { second: 16, handle: 'dp_dreamer', problem: 'C', verdict: 'rejected' },
  { second: 20, handle: 'bytebloom', problem: 'D', verdict: 'accepted' },
  { second: 24, handle: 'dp_dreamer', problem: 'C', verdict: 'accepted' },
  { second: 27, handle: 'stacktrace', problem: 'A', verdict: 'accepted' },
] as const;

type ProblemState = { attempts: number; solvedAt?: number };

const formatClock = (seconds: number) => `00:${Math.floor(seconds / 60)
  .toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

export default function MiniContestSimulation() {
  const container = useRef<HTMLElement | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isVisible, setIsVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const applyPreference = () => {
      setReducedMotion(media.matches);
      if (media.matches) {
        setElapsed(DURATION_SECONDS);
        setIsPlaying(false);
      }
    };
    applyPreference();
    media.addEventListener('change', applyPreference);
    return () => media.removeEventListener('change', applyPreference);
  }, []);

  useEffect(() => {
    if (!container.current || !('IntersectionObserver' in window)) return undefined;
    const observer = new IntersectionObserver(([entry]) => setIsVisible(entry.isIntersecting), {
      threshold: 0.25,
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isPlaying || !isVisible || reducedMotion) return undefined;
    const timer = window.setInterval(() => {
      setElapsed((current) => (current >= DURATION_SECONDS ? 0 : current + 0.25));
    }, 250);
    return () => window.clearInterval(timer);
  }, [isPlaying, isVisible, reducedMotion]);

  const rows = useMemo(() => participants.map((handle) => {
    const problemStates = new Map<string, ProblemState>();
    problems.forEach((problem) => problemStates.set(problem, { attempts: 0 }));
    events.filter((event) => event.handle === handle && event.second <= elapsed).forEach((event) => {
      const state = problemStates.get(event.problem) as ProblemState;
      state.attempts += 1;
      if (event.verdict === 'accepted') state.solvedAt = event.second;
    });
    const solved = Array.from(problemStates.values()).filter((state) => state.solvedAt).length;
    const penalty = Array.from(problemStates.values()).reduce((total, state) => (
      total + (state.solvedAt ? state.solvedAt + (state.attempts - 1) * 5 : 0)
    ), 0);
    return { handle, problemStates, solved, penalty };
  }).sort((first, second) => (
    second.solved - first.solved || first.penalty - second.penalty
  )), [elapsed]);

  const latestEvent = [...events].reverse().find((event) => event.second <= elapsed);

  return (
    <section
      aria-label="Mini contest simulation"
      className="broadcast-panel overflow-hidden rounded-md"
      ref={container}
    >
      <header className="flex items-center justify-between border-b border-[#25364d] bg-[#081525] px-4 py-3">
        <div>
          <p className="broadcast-label">Live preview</p>
          <h2 className="font-broadcast text-xl font-semibold uppercase tracking-wide text-white">
            Pocket Invitational
          </h2>
        </div>
        <div className="text-right">
          <p className="broadcast-label">Contest time</p>
          <p className="font-data text-lg text-white">{formatClock(elapsed)}</p>
        </div>
      </header>

      <div className="grid grid-cols-[2rem_minmax(7rem,1fr)_3rem_3rem_repeat(4,2.25rem)] border-b border-[#25364d] bg-[#13243a] px-2 py-2 text-center text-xs text-[#91a3ba]">
        <span>#</span><span className="text-left">Handle</span><span>Σ</span><span>Pen</span>
        {problems.map((problem) => <span key={problem}>{problem}</span>)}
      </div>
      <div aria-live="polite">
        {rows.map((row, index) => (
          <div
            className="grid grid-cols-[2rem_minmax(7rem,1fr)_3rem_3rem_repeat(4,2.25rem)] items-center border-b border-[#25364d]/70 px-2 py-2 text-center text-sm transition-transform"
            key={row.handle}
          >
            <span className="font-data text-[#91a3ba]">{index + 1}</span>
            <span className="truncate text-left font-medium text-white">{row.handle}</span>
            <span className="font-data font-medium text-white">{row.solved}</span>
            <span className="font-data text-xs text-[#91a3ba]">{row.penalty}</span>
            {problems.map((problem) => {
              const state = row.problemStates.get(problem) as ProblemState;
              const stateClass = state.solvedAt
                ? 'bg-[#21c16b] text-[#03170d]'
                : state.attempts > 0 ? 'bg-[#eb5757] text-white' : 'bg-[#13243a] text-[#64758c]';
              return (
                <span className={`mx-auto flex h-7 w-8 items-center justify-center rounded-sm font-data ${stateClass}`} key={problem}>
                  {state.solvedAt ? `+${state.attempts > 1 ? state.attempts - 1 : ''}`
                    : state.attempts > 0 ? `-${state.attempts}` : '·'}
                </span>
              );
            })}
          </div>
        ))}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 bg-[#081525] px-4 py-3">
        <p className="min-w-0 text-sm text-[#91a3ba]">
          {latestEvent
            ? <><span className="text-white">{latestEvent.handle}</span> submitted {latestEvent.problem}</>
            : 'Waiting for the first submission…'}
        </p>
        <div className="flex items-center gap-2">
          <button
            className="rounded-sm border border-[#25364d] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#13243a]"
            disabled={reducedMotion}
            onClick={() => setIsPlaying((playing) => !playing)}
            type="button"
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            className="rounded-sm border border-[#25364d] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#13243a]"
            onClick={() => { setElapsed(0); setIsPlaying(!reducedMotion); }}
            type="button"
          >
            Restart
          </button>
          <Link className="text-sm font-semibold text-[#65adff] underline underline-offset-4" href="/contests/1735/replay?contestType=normal&startTime=2%3A50&playbackSpeed=15&autoplay=true&demo=true&h=TWF0ZW9DVjttYy5fY2FyaTtkbWdhNDQ7TWFyY2tlc3M7anVsaWFuZmVycmVzO3BhY2hhMjg4MDtHaWdhX0Nyb25vczttYXJ0aW5zO21hcnRpbml1cztNYXRlbztNZXNTaW1vbkZhbGxvbjE5O1NjYW5vO0FnYXJpYztlc3RveS1yZS1zZWJhZG87VGFpbmVsO01hcmNlYW50YXN5O0FuZ3J5U2VhbA">
            Full replay
          </Link>
        </div>
      </footer>
    </section>
  );
}
