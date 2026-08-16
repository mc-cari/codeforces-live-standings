import { useEffect, useMemo, useRef, useState } from 'react';
import type { Submission } from '@/src/shared/domain/contest';
import LiveSubmission from '@/components/LiveSubmission';

const DURATION_SECONDS = 28;
const DEFAULT_PARTICIPANTS = ['bytebloom', 'dp_dreamer', 'greedyfox', 'stacktrace'];
const problems = ['A', 'B', 'C', 'D'];
const problemPoints: Record<string, number> = { A: 500, B: 750, C: 1_000, D: 1_250 };
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
type MiniContestSimulationProps = { contestId?: number; contestName?: string; handles?: string[] };
type PreviewParticipant = { handle: string; participantIndex: number };

const formatClock = (seconds: number) => `00:${Math.floor(seconds / 60)
  .toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

const buildPreviewSubmission = (
  contestId: number,
  event: typeof events[number],
  participant: PreviewParticipant,
  rank: number,
  solved: number,
): Submission => {
  const points = problemPoints[event.problem];
  const accepted = event.verdict === 'accepted';
  return {
    id: event.second * 10 + event.participantIndex,
    contestId,
    creationTimeSeconds: event.second,
    relativeTimeSeconds: event.second,
    problem: {
      contestId,
      problemSetName: '',
      index: event.problem,
      name: `Problem ${event.problem}`,
      type: 'PROGRAMMING',
      points,
      rating: 0,
      tags: [],
    },
    author: {
      contestId,
      members: [{ handle: participant.handle, name: participant.handle }],
      participantType: 'CONTESTANT',
      teamId: undefined,
      teamName: undefined,
      ghost: false,
      room: undefined,
      startTimeSeconds: undefined,
      rank,
    },
    programmingLanguage: 'GNU C++17',
    verdict: accepted ? 'OK' : 'WRONG_ANSWER',
    testset: 'TESTS',
    passedTestCount: accepted ? 42 : 0,
    timeConsumedMillis: 0,
    memoryConsumedBytes: 0,
    points: accepted ? points : 0,
    numberOfProblems: solved,
  };
};

export default function MiniContestSimulation({
  contestId = 1735, contestName, handles,
}: MiniContestSimulationProps) {
  const container = useRef<HTMLElement | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isSetupUpdating, setIsSetupUpdating] = useState(false);
  const [participantSlots, setParticipantSlots] = useState<Map<string, number>>(new Map());

  const configuredHandles = useMemo(() => (handles || []).filter(Boolean).slice(0, 4), [handles]);
  const previewParticipants = useMemo<PreviewParticipant[]>(() => {
    if (configuredHandles.length === 0) {
      return DEFAULT_PARTICIPANTS.map((handle, participantIndex) => ({ handle, participantIndex }));
    }

    const usedSlots = new Set<number>();
    return configuredHandles.map((handle) => {
      const handleKey = handle.toLocaleLowerCase();
      const knownSlot = participantSlots.get(handleKey);
      const participantIndex = knownSlot !== undefined && !usedSlots.has(knownSlot)
        ? knownSlot
        : [0, 1, 2, 3].find((slot) => !usedSlots.has(slot)) || 0;
      usedSlots.add(participantIndex);
      return { handle, participantIndex };
    });
  }, [configuredHandles, participantSlots]);
  const displayContestName = contestName || 'Pocket Invitational';

  useEffect(() => {
    if (configuredHandles.length === 0) return undefined;
    const timer = window.setTimeout(() => {
      setParticipantSlots((current) => {
        const next = new Map(current);
        const usedSlots = new Set<number>();
        let changed = false;
        configuredHandles.forEach((handle) => {
          const handleKey = handle.toLocaleLowerCase();
          const knownSlot = next.get(handleKey);
          const participantIndex = knownSlot !== undefined && !usedSlots.has(knownSlot)
            ? knownSlot
            : [0, 1, 2, 3].find((slot) => !usedSlots.has(slot)) || 0;
          if (next.get(handleKey) !== participantIndex) {
            next.set(handleKey, participantIndex);
            changed = true;
          }
          usedSlots.add(participantIndex);
        });
        return changed ? next : current;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [configuredHandles]);

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

  const rows = useMemo(() => previewParticipants.map(({ handle, participantIndex }) => {
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
    const points = Array.from(problemStates.entries()).reduce((total, [problem, state]) => (
      total + (state.solvedAt ? problemPoints[problem] : 0)
    ), 0);
    return { handle, participantIndex, problemStates, solved, penalty, points };
  }).sort((first, second) => (
    second.points - first.points || first.penalty - second.penalty
  )), [elapsed, previewParticipants, visibleEvents]);

  const latestEvent = [...visibleEvents].reverse().find((event) => event.second <= elapsed);
  const latestParticipant = latestEvent
    ? previewParticipants.find((participant) => participant.participantIndex === latestEvent.participantIndex)
    : undefined;
  const latestRow = latestEvent
    ? rows.find((row) => row.participantIndex === latestEvent.participantIndex)
    : undefined;
  const latestRank = latestEvent
    ? rows.findIndex((row) => row.participantIndex === latestEvent.participantIndex) + 1
    : 0;
  const latestSubmission = latestEvent && latestParticipant && latestRow
    ? buildPreviewSubmission(contestId, latestEvent, latestParticipant, latestRank, latestRow.solved)
    : undefined;
  const recentEvents = visibleEvents.filter((event) => (
    event.second <= elapsed && elapsed - event.second < RECENT_EVENT_WINDOW_SECONDS
  ));
  const isLatestSubmissionRecent = Boolean(latestEvent && recentEvents.some((event) => (
    event.participantIndex === latestEvent.participantIndex
      && event.problem === latestEvent.problem
  )));
  const displayedSubmission = latestSubmission && isLatestSubmissionRecent
    ? { ...latestSubmission, verdict: 'TESTING', passedTestCount: Math.max(1, latestSubmission.passedTestCount) }
    : latestSubmission;

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
          <p className="font-data text-lg text-white" data-testid="mini-contest-clock">{formatClock(elapsed)}</p>
        </div>
      </header>

      <div className="grid grid-cols-[2rem_minmax(0,1fr)_3rem_3rem_repeat(4,minmax(1.75rem,2.25rem))] border-b border-[#25364d] bg-[#13243a] px-2 py-2 text-center text-xs text-[#91a3ba]">
        <span>#</span><span className="text-left">Handle</span><span>PTS</span><span>Σ</span>
        {problems.map((problem) => <span key={problem}>{problem}</span>)}
      </div>
      <div aria-live="polite">
        {rows.map((row, index) => (
          <div
            className={`grid grid-cols-[2rem_minmax(0,1fr)_3rem_3rem_repeat(4,minmax(1.75rem,2.25rem))] items-center border-b border-[#25364d]/70 px-2 py-2 text-center text-sm transition-all ${isSetupUpdating || (!reducedMotion && recentEvents.some((event) => event.participantIndex === row.participantIndex)) ? 'animate-pulse bg-[#0b2642]' : ''}`}
            key={row.handle}
          >
            <span className="font-data text-[#91a3ba]">{index + 1}</span>
            <span className="truncate text-left font-medium text-white">{row.handle}</span>
            <span className="font-data font-medium text-white">{row.points}</span>
            <span className="font-data text-xs text-[#91a3ba]">{row.solved}</span>
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

      <div aria-live="polite" className="h-8 overflow-hidden bg-[#081525]">
        {displayedSubmission ? (
          <LiveSubmission
            key={displayedSubmission.id}
            compact
            isGym={false}
            isNew={!reducedMotion && isLatestSubmissionRecent}
            submission={displayedSubmission}
            userCount={previewParticipants.length}
            userRank={new Map()}
          />
        ) : (
          <div className="flex h-full items-center px-4 text-xs text-[#64758c]">Waiting for the first submission…</div>
        )}
      </div>
    </section>
  );
}
