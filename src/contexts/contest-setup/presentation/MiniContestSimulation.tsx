import { useEffect, useMemo, useRef, useState } from 'react';

const DURATION_SECONDS = 28;
const DEFAULT_PARTICIPANTS = ['bytebloom', 'dp_dreamer', 'greedyfox', 'stacktrace'];
const problems = ['A', 'B', 'C', 'D'];
const events = [
  { second: 2, participantIndex: 2, problem: 'A', verdict: 'rejected' },
  { second: 5, participantIndex: 0, problem: 'A', verdict: 'accepted' },
  { second: 8, participantIndex: 3, problem: 'B', verdict: 'accepted' },
  { second: 12, participantIndex: 2, problem: 'A', verdict: 'accepted' },
  { second: 16, participantIndex: 1, problem: 'C', verdict: 'rejected' },
  { second: 20, participantIndex: 0, problem: 'D', verdict: 'accepted' },
  { second: 24, participantIndex: 1, problem: 'C', verdict: 'accepted' },
  { second: 27, participantIndex: 3, problem: 'A', verdict: 'accepted' },
] as const;
const RECENT_EVENT_WINDOW_SECONDS = 1;

type ProblemState = { attempts: number; solvedAt?: number };
type MiniContestSimulationProps = { contestName?: string; handles?: string[] };

const formatClock = (seconds: number) => `00:${Math.floor(seconds / 60)
  .toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

export default function MiniContestSimulation({ contestName, handles }: MiniContestSimulationProps) {
  const container = useRef<HTMLElement | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isSetupUpdating, setIsSetupUpdating] = useState(false);

  const previewParticipants = useMemo(() => {
    const configuredHandles = (handles || []).filter(Boolean).slice(0, 4);
    return configuredHandles.length > 0 ? configuredHandles : DEFAULT_PARTICIPANTS;
  }, [handles]);
  const displayContestName = contestName || 'Pocket Invitational';

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const applyPreference = () => {
      setReducedMotion(media.matches);
      if (media.matches) {
        setElapsed(DURATION_SECONDS);
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
    if (!isVisible || reducedMotion) return undefined;
    const timer = window.setInterval(() => {
      setElapsed((current) => (current >= DURATION_SECONDS ? 0 : current + 0.25));
    }, 250);
    return () => window.clearInterval(timer);
  }, [isVisible, reducedMotion]);

  useEffect(() => {
    const startTimer = window.setTimeout(() => setIsSetupUpdating(!reducedMotion), 0);
    const endTimer = window.setTimeout(() => setIsSetupUpdating(false), 700);
    return () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(endTimer);
    };
  }, [displayContestName, previewParticipants, reducedMotion]);

  const visibleEvents = useMemo(
    () => events.filter((event) => event.participantIndex < previewParticipants.length),
    [previewParticipants.length],
  );

  const rows = useMemo(() => previewParticipants.map((handle, participantIndex) => {
    const problemStates = new Map<string, ProblemState>();
    problems.forEach((problem) => problemStates.set(problem, { attempts: 0 }));
    visibleEvents.filter((event) => event.participantIndex === participantIndex && event.second <= elapsed).forEach((event) => {
      const state = problemStates.get(event.problem) as ProblemState;
      state.attempts += 1;
      if (event.verdict === 'accepted') state.solvedAt = event.second;
    });
    const solved = Array.from(problemStates.values()).filter((state) => state.solvedAt).length;
    const penalty = Array.from(problemStates.values()).reduce((total, state) => (
      total + (state.solvedAt ? state.solvedAt + (state.attempts - 1) * 5 : 0)
    ), 0);
    return { handle, participantIndex, problemStates, solved, penalty };
  }).sort((first, second) => (
    second.solved - first.solved || first.penalty - second.penalty
  )), [elapsed, previewParticipants, visibleEvents]);

  const latestEvent = [...visibleEvents].reverse().find((event) => event.second <= elapsed);
  const recentEvents = visibleEvents.filter((event) => (
    event.second <= elapsed && elapsed - event.second < RECENT_EVENT_WINDOW_SECONDS
  ));

  return (
    <section
      aria-label="Mini contest simulation"
      className="broadcast-panel overflow-hidden rounded-md"
      ref={container}
    >
      <header className="flex items-center justify-between border-b border-[#25364d] bg-[#081525] px-4 py-3">
        <div>
          <p className="broadcast-label">Live preview</p>
          <h2 className={`font-broadcast text-xl font-semibold uppercase tracking-wide text-white ${isSetupUpdating ? 'animate-pulse' : ''}`}>
            {displayContestName}
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
            className={`grid grid-cols-[2rem_minmax(7rem,1fr)_3rem_3rem_repeat(4,2.25rem)] items-center border-b border-[#25364d]/70 px-2 py-2 text-center text-sm transition-all ${isSetupUpdating || (!reducedMotion && recentEvents.some((event) => event.participantIndex === row.participantIndex)) ? 'animate-pulse bg-[#0b2642]' : ''}`}
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
              const hasRecentEvent = recentEvents.some((event) => (
                event.participantIndex === row.participantIndex && event.problem === problem
              ));
              return (
                <span className={`mx-auto flex h-7 w-8 items-center justify-center rounded-sm font-data ${stateClass} ${hasRecentEvent && !reducedMotion ? 'animate-pulse ring-2 ring-[#9fc8ff]/70' : ''}`} key={problem}>
                  {state.solvedAt ? `+${state.attempts > 1 ? state.attempts - 1 : ''}`
                    : state.attempts > 0 ? `-${state.attempts}` : '·'}
                </span>
              );
            })}
          </div>
        ))}
      </div>

      <footer className="bg-[#081525] px-4 py-3">
        <p className="min-w-0 text-sm text-[#91a3ba]">
          {latestEvent
            ? <><span className="text-white">{previewParticipants[latestEvent.participantIndex]}</span> submitted {latestEvent.problem}</>
            : 'Waiting for the first submission…'}
        </p>
      </footer>
    </section>
  );
}
