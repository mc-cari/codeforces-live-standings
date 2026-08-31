import React, {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import type {
  ReplayParty,
  ReplayStandings,
  ReplaySubmission,
} from '../domain/models';
import type { Standings, Submission } from '@/src/shared/domain/contest';
import LiveSubmissionsList from '@/components/LiveSubmissionsList';
import StandingsList from '@/components/standings/StandingsList';
import ContestLoading from '@/components/ContestLoading';
import getName from '@/src/shared/domain/party';
import { addMissingParticipantRows } from '@/src/shared/domain/standings';
import { buildReplaySnapshot } from '../domain/buildReplaySnapshot';
import {
  LOADING_PROGRESS,
  MAX_SUBMISSIONS_IN_MEMORY,
  REPLAY_ARTIFICIAL_JUDGING_SPEED_MAX,
  REPLAY_JUDGING_BASE_DURATION_MILLISECONDS,
  REPLAY_JUDGING_DURATION_VARIATION_MILLISECONDS,
  REPLAY_JUDGING_MAX_MILESTONES,
  REPLAY_JUDGING_MIN_MILESTONES,
  REPLAY_JUDGING_TICK_MILLISECONDS,
  REPLAY_PLAYBACK_TICK_MILLISECONDS,
  REPLAY_RELEASE_BATCH_SIZE,
  REPLAY_SPEED_OPTIONS,
} from '@/src/shared/config/contestTiming';
import { getHandlesFromQuery } from '@/src/shared/domain/participantHandles';
import ContestRibbon from '@/src/shared/presentation/ContestRibbon';
import {
  formatElapsedTime,
  getPlaybackSpeed,
  getQueryValue,
  getStartTime,
} from '../domain/replayConfiguration';
import { codeforcesReplayGateway } from '../infrastructure/codeforcesReplayGateway';

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

type JudgingJob = {
  progress: number;
  totalTests: number;
  duration: number;
};

export default function ReplayPage() {
  const router = useRouter();
  const {
    contestId, contestType, handles, h, startMinute, startTime, playbackSpeed, autoplay, demo,
  } = router.query;
  const userHandles = useMemo(() => getHandlesFromQuery(handles, h), [h, handles]);
  const requestedSpeed = getPlaybackSpeed(getQueryValue(playbackSpeed));
  const [finalStandings, setFinalStandings] = useState<ReplayStandings>();
  const [events, setEvents] = useState<ReplaySubmission[]>([]);
  const [userRank, setUserRank] = useState<Map<string, string>>(new Map<string, string>());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isTruncated, setIsTruncated] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(LOADING_PROGRESS.initial);
  const [loadingStage, setLoadingStage] = useState('Preparing replay...');
  const previousTick = useRef<number | undefined>(undefined);
  const previousReplayTime = useRef<number | undefined>(undefined);
  const judgingJobs = useRef<Map<number, JudgingJob>>(new Map());
  const previousJudgingTick = useRef<number | undefined>(undefined);
  const [testingSubmissions, setTestingSubmissions] = useState<Map<number, number>>(new Map());
  const testingSubmissionsRef = useRef<Map<number, number>>(new Map());
  const [mobilePanel, setMobilePanel] = useState<'standings' | 'submissions'>('standings');
  const clearJudging = useCallback(() => {
    judgingJobs.current.clear();
    const next = new Map<number, number>();
    testingSubmissionsRef.current = next;
    setTestingSubmissions(next);
  }, []);

  useEffect(() => {
    if (!router.isReady) return undefined;
    let isActive = true;
    let finishTimer: number | undefined;
    const controller = new AbortController();
    const hasReplayParameters = Boolean(contestId && userHandles.length > 0 && contestType);
    const progressTimer = window.setInterval(() => {
      setLoadingProgress((current) => {
        if (current >= LOADING_PROGRESS.estimatedMaximum) return current;
        return Math.min(
          LOADING_PROGRESS.estimatedMaximum,
          current + (current < LOADING_PROGRESS.submissionsLoaded
            ? LOADING_PROGRESS.fastIncrement : LOADING_PROGRESS.slowIncrement),
        );
      });
    }, LOADING_PROGRESS.tickMilliseconds);

    const loadReplay = async () => {
      try {
        setIsLoading(true);
        setLoadingProgress(LOADING_PROGRESS.initial);
        setLoadingStage('Loading contest data...');
        setError('');
        if (!hasReplayParameters) {
          throw new Error('Replay requires a contest, contest type, and participant handles');
        }
        const markLoaded = (progress: number, stage: string) => {
          if (!isActive) return;
          setLoadingProgress((current) => Math.max(current, progress));
          setLoadingStage(stage);
        };
        if (contestId === '1735' && getQueryValue(demo) === 'true') {
          const response = await fetch('/demo/1735-v1.json', { signal: controller.signal });
          if (!isActive) return;
          if (!response.ok) throw new Error('Unable to load demo replay');
          const snapshot = await response.json() as {
            standings: ReplayStandings;
            submissions: ReplaySubmission[];
            userRanks: Record<string, string>;
          };
          if (!isActive) return;
          const demoEvents = [...snapshot.submissions].sort((first, second) => (
            first.relativeTimeSeconds - second.relativeTimeSeconds || first.id - second.id
          ));
          const demoStandings = addMissingParticipantRows(
            snapshot.standings,
            demoEvents,
            getName,
          );
          setFinalStandings(demoStandings);
          setEvents(demoEvents);
          setUserRank(new Map(Object.entries(snapshot.userRanks)));
          setElapsedSeconds(getStartTime(
            getQueryValue(startTime) || getQueryValue(startMinute),
            demoStandings.contest.durationSeconds,
            demoEvents[0]?.relativeTimeSeconds || 0,
          ));
          setSpeed(requestedSpeed);
          setIsPlaying(getQueryValue(autoplay) === 'true');
          setIsTruncated(false);
          markLoaded(LOADING_PROGRESS.submissionsLoaded, 'Preparing demo replay...');
          return;
        }
        const statusRequest = codeforcesReplayGateway.getSubmissions(
          contestId as string,
          userHandles,
          controller.signal,
        ).then((result) => {
          markLoaded(LOADING_PROGRESS.submissionsLoaded, 'Preparing replay timeline...');
          return result;
        });
        const standingsRequest = codeforcesReplayGateway.getStandings(
          contestId as string,
          controller.signal,
        ).then((result) => {
            markLoaded(LOADING_PROGRESS.standingsLoaded, 'Loading contest submissions...');
            return result;
          });
        const usersRequest = codeforcesReplayGateway.getUsers(userHandles, controller.signal)
          .catch(() => []);
        const [standingsData, allSelectedEvents, users] = await Promise.all([
          standingsRequest, statusRequest, usersRequest,
        ]);
        if (!isActive) return;
        const isSelectedParticipant = (party: ReplayParty) => party.members
          .some((member) => userHandles.some((handle) => (
            handle.toLowerCase() === member.handle.toLowerCase()
          )));
        const officialStandings: ReplayStandings = {
          ...standingsData,
          rows: standingsData.rows.filter((row) => isSelectedParticipant(row.party)),
        };
        const replayEvents = allSelectedEvents
          .filter((submission) => (
            submission.relativeTimeSeconds >= 0
            && submission.relativeTimeSeconds <= officialStandings.contest.durationSeconds
          ))
          .sort((first, second) => (
            first.relativeTimeSeconds - second.relativeTimeSeconds || first.id - second.id
          ));
        const selectedStandings = addMissingParticipantRows(
          officialStandings,
          replayEvents,
          getName,
        );
        setIsTruncated(replayEvents.length > MAX_SUBMISSIONS_IN_MEMORY);
        setEvents(replayEvents.slice(-MAX_SUBMISSIONS_IN_MEMORY));
        const replayStart = replayEvents.length > MAX_SUBMISSIONS_IN_MEMORY
          ? replayEvents[replayEvents.length - MAX_SUBMISSIONS_IN_MEMORY].relativeTimeSeconds : 0;
        setElapsedSeconds(getStartTime(
          getQueryValue(startTime) || getQueryValue(startMinute),
          selectedStandings.contest.durationSeconds,
          replayStart,
        ));
        setSpeed(requestedSpeed);
        setIsPlaying(getQueryValue(autoplay) === 'true');
        setFinalStandings(selectedStandings);

        if (users.length > 0) {
          const ranks = new Map<string, string>();
          users.forEach((user) => {
            const rank = user.rank || 'unrated';
            ranks.set(user.handle, rank);
            ranks.set(`${user.handle} (practice)`, rank);
          });
          setUserRank(ranks);
        }
      } catch (loadError) {
        if (isActive) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load replay data');
        }
      } finally {
        window.clearInterval(progressTimer);
        if (isActive) {
          setLoadingProgress(LOADING_PROGRESS.complete);
          if (!hasReplayParameters) {
            setIsLoading(false);
          } else {
            finishTimer = window.setTimeout(
              () => setIsLoading(false),
              LOADING_PROGRESS.completionDelayMilliseconds,
            );
          }
        }
      }
    };
    loadReplay();
    return () => {
      isActive = false;
      controller.abort();
      window.clearInterval(progressTimer);
      if (finishTimer) window.clearTimeout(finishTimer);
    };
  }, [autoplay, contestId, contestType, demo, requestedSpeed, router.isReady, startMinute, startTime, userHandles]);

  useEffect(() => {
    if (!isPlaying || !finalStandings) return undefined;
    previousTick.current = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = ((now - (previousTick.current as number)) / 1000) * speed;
      previousTick.current = now;
      const next = Math.min(finalStandings.contest.durationSeconds, elapsedSeconds + elapsed);
      setElapsedSeconds(() => next);
      if (next === finalStandings.contest.durationSeconds) setIsPlaying(false);
    }, REPLAY_PLAYBACK_TICK_MILLISECONDS);
    return () => window.clearInterval(timer);
  }, [elapsedSeconds, finalStandings, isPlaying, speed]);

  useBrowserLayoutEffect(() => {
    const previousTime = previousReplayTime.current;
    previousReplayTime.current = elapsedSeconds;

    if (previousTime === undefined) return undefined;
    if (elapsedSeconds < previousTime || speed > REPLAY_ARTIFICIAL_JUDGING_SPEED_MAX) {
      clearJudging();
      return undefined;
    }
    if (!isPlaying) return undefined;

    const releasedEvents = events.filter((event) => (
      event.relativeTimeSeconds > previousTime && event.relativeTimeSeconds <= elapsedSeconds
    )).slice(-REPLAY_RELEASE_BATCH_SIZE);
    releasedEvents.forEach((submission) => {
      if (judgingJobs.current.has(submission.id)) return;
      const totalTests = submission.verdict === 'OK'
        ? Math.max(1, submission.passedTestCount)
        : Math.max(1, submission.passedTestCount + 1);
      judgingJobs.current.set(submission.id, {
        progress: 0,
        totalTests,
        duration: REPLAY_JUDGING_BASE_DURATION_MILLISECONDS
          + ((submission.id % 5) - 2) * REPLAY_JUDGING_DURATION_VARIATION_MILLISECONDS,
      });
      setTestingSubmissions((current) => new Map(current).set(submission.id, 1));
    });

    return undefined;
  }, [clearJudging, elapsedSeconds, events, isPlaying, speed]);

  useEffect(() => {
    if (
      !isPlaying
      || speed > REPLAY_ARTIFICIAL_JUDGING_SPEED_MAX
      || judgingJobs.current.size === 0
    ) return undefined;
    previousJudgingTick.current = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - (previousJudgingTick.current as number);
      previousJudgingTick.current = now;
      const next = new Map(testingSubmissionsRef.current);
      judgingJobs.current.forEach((job, submissionId) => {
        job.progress += (elapsed * Math.sqrt(speed)) / job.duration;
        if (job.progress >= 1) {
          judgingJobs.current.delete(submissionId);
          next.delete(submissionId);
          return;
        }
        const milestones = Math.min(
          REPLAY_JUDGING_MAX_MILESTONES,
          Math.max(REPLAY_JUDGING_MIN_MILESTONES, Math.ceil(job.totalTests / 3)),
        );
        const stage = Math.max(1, Math.ceil(job.progress * milestones));
        next.set(submissionId, Math.max(1, Math.ceil((stage * job.totalTests) / milestones)));
      });
      testingSubmissionsRef.current = next;
      setTestingSubmissions(next);
    }, REPLAY_JUDGING_TICK_MILLISECONDS);
    return () => window.clearInterval(timer);
  }, [isPlaying, speed, testingSubmissions.size]);

  const replayStart = events[0]?.relativeTimeSeconds || 0;
  const availableSpeeds = REPLAY_SPEED_OPTIONS.includes(speed)
    ? REPLAY_SPEED_OPTIONS : [...REPLAY_SPEED_OPTIONS, speed].sort((first, second) => first - second);
  const settledEvents = useMemo(() => (
    events.filter((event) => !testingSubmissions.has(event.id))
  ), [events, testingSubmissions]);
  const snapshot = useMemo(() => (
    finalStandings ? buildReplaySnapshot(finalStandings, settledEvents, elapsedSeconds) : undefined
  ), [elapsedSeconds, finalStandings, settledEvents]);
  const cinematicSubmissions = useMemo(() => {
    if (!snapshot) return [];
    const testingRows = events.filter((event) => testingSubmissions.has(event.id)).map((submission) => ({
      ...submission,
      author: {
        ...submission.author,
        rank: snapshot.localStandings.get(getName(submission.author)) as number,
      },
      numberOfProblems: 0,
      verdict: 'TESTING',
      passedTestCount: testingSubmissions.get(submission.id) as number,
    }));
    return [...testingRows, ...snapshot.submissions]
      .sort((first, second) => second.id - first.id)
      .slice(0, MAX_SUBMISSIONS_IN_MEMORY);
  }, [events, snapshot, testingSubmissions]);

  if (isLoading) {
    return <ContestLoading progress={loadingProgress} stage={loadingStage} />;
  }
  if (error || !finalStandings || !snapshot) {
    return (
      <div className="flex items-center justify-center min-h-screen text-xl text-red-400 bg-black">
        {error || 'Replay data is unavailable'}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#07111f] text-white">
      <ContestRibbon
        clock={formatElapsedTime(elapsedSeconds)}
        contest={finalStandings.contest}
        contestId={String(contestId || '')}
        mode="REPLAY"
        statusTone={isPlaying ? 'live' : 'paused'}
      />
      <div className="border-b border-[#25364d] bg-[#0d1b2a] px-3 py-2">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3">
          <span className="font-data text-sm text-[#91a3ba]">
            {formatElapsedTime(elapsedSeconds)} / {formatElapsedTime(finalStandings.contest.durationSeconds)}
          </span>
          <input
            aria-label="Replay timeline"
            className="min-w-40 grow accent-[#2d8cff]"
            max={finalStandings.contest.durationSeconds}
            min={replayStart}
            onChange={(event) => {
              setIsPlaying(false);
              clearJudging();
              setElapsedSeconds(Number(event.target.value));
            }}
            type="range"
            value={elapsedSeconds}
          />
          <label className="flex items-center gap-2 text-sm text-[#91a3ba]">
            Speed
            <select
              className="rounded-sm border border-[#25364d] bg-[#081525] px-2 py-1 text-white"
              onChange={(event) => setSpeed(Number(event.target.value))}
              value={speed}
            >
              {availableSpeeds.map((option) => <option key={option} value={option}>{option}×</option>)}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              className="rounded-sm bg-[#2d8cff] px-3 py-2 text-sm font-semibold hover:bg-[#1f78d7]"
              onClick={() => setIsPlaying((playing) => !playing)}
              type="button"
            >
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              className="rounded-sm border border-[#25364d] bg-[#13243a] px-3 py-2 text-sm font-semibold hover:bg-[#1b304a]"
              onClick={() => { setIsPlaying(false); clearJudging(); setElapsedSeconds(replayStart); }}
              type="button"
            >
              Restart
            </button>
          </div>
          {isTruncated && (
            <span className="text-sm text-[#f3b83f]">
              Latest {MAX_SUBMISSIONS_IN_MEMORY.toLocaleString()} events retained
            </span>
          )}
      </div>
      </div>
      <div className="grid grid-cols-2 border-b border-[#25364d] bg-[#0d1b2a] lg:hidden" role="tablist">
        {(['standings', 'submissions'] as const).map((panel) => (
          <button
            aria-selected={mobilePanel === panel}
            className={`py-3 text-sm font-semibold capitalize ${mobilePanel === panel ? 'border-b-2 border-[#2d8cff] text-white' : 'text-[#91a3ba]'}`}
            key={panel}
            onClick={() => setMobilePanel(panel)}
            role="tab"
            type="button"
          >
            {panel}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 grow">
        <section className={`${mobilePanel === 'submissions' ? 'block' : 'hidden'} h-[calc(100vh-153px)] w-full p-2 lg:block lg:h-[calc(100vh-105px)] lg:w-2/5 lg:p-3`} aria-label="Replay submissions">
          <div className="h-full overflow-hidden rounded-sm broadcast-panel">
            <LiveSubmissionsList
              submissions={cinematicSubmissions as unknown as Submission[]}
              newSubmissionsCount={testingSubmissions.size}
              globalStandings={snapshot.standings as unknown as Standings}
              userRank={userRank}
            />
          </div>
        </section>
        <section className={`${mobilePanel === 'standings' ? 'block' : 'hidden'} h-[calc(100vh-153px)] w-full p-2 lg:block lg:h-[calc(100vh-105px)] lg:w-3/5 lg:p-3`} aria-label="Replay standings">
          <div className="h-full overflow-hidden rounded-sm broadcast-panel">
            <StandingsList
              contestType={contestType as string}
              globalStandings={snapshot.standings as unknown as Standings}
              localStandings={snapshot.localStandings}
              userRank={userRank}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async () => ({ props: {} });
