import React, {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import LiveSubmissionsList from '../../../components/LiveSubmissionsList';
import StandingsList from '../../../components/standings/StandingsList';
import ContestLoading from '../../../components/ContestLoading';
import codeforcesFetch from '../../../utils/codeforcesFetch';
import getName from '../../../utils/getName';
import { buildReplaySnapshot } from '../../../utils/replay';
import {
  LOADING_PROGRESS,
  MAX_REPLAY_PLAYBACK_SPEED,
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
} from '../../../utils/constants';
import { getHandlesFromQuery } from '../../../utils/handlesQuery';

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

type JudgingJob = {
  progress: number;
  totalTests: number;
  duration: number;
};

const formatElapsedTime = (seconds: number) => {
  const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${remainingSeconds}`;
};

const getQueryValue = (value: string | string[] | undefined) => (
  typeof value === 'string' ? value : undefined
);

const getPlaybackSpeed = (value: string | undefined) => {
  const speed = Number(value);
  return Number.isFinite(speed) && speed > 0 && speed <= MAX_REPLAY_PLAYBACK_SPEED ? speed : 1;
};

const getStartTime = (value: string | undefined, durationSeconds: number, replayStart: number) => {
  if (!value) return replayStart;
  const timestamp = value.match(/^(\d+):(\d{1,2})$/);
  const seconds = timestamp
    ? Number(timestamp[1]) * 60 + Number(timestamp[2])
    : Number(value) * 60;
  if (!Number.isFinite(seconds) || seconds < 0) return replayStart;
  return Math.max(replayStart, Math.min(durationSeconds, seconds));
};

export default function Replay() {
  const router = useRouter();
  const {
    contestId, contestType, handles, h, startMinute, startTime, playbackSpeed, autoplay,
  } = router.query;
  const userHandles = useMemo(() => getHandlesFromQuery(handles, h), [h, handles]);
  const requestedSpeed = getPlaybackSpeed(getQueryValue(playbackSpeed));
  const [finalStandings, setFinalStandings] = useState<Standings>();
  const [events, setEvents] = useState<Submission[]>([]);
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
  const clearJudging = useCallback(() => {
    judgingJobs.current.clear();
    setTestingSubmissions(new Map());
  }, []);

  useEffect(() => {
    let isActive = true;
    let finishTimer: number | undefined;
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
      if (!contestId || userHandles.length === 0 || !contestType) return;

      try {
        setIsLoading(true);
        setLoadingProgress(LOADING_PROGRESS.initial);
        setLoadingStage('Loading contest data...');
        setError('');
        const markLoaded = (progress: number, stage: string) => {
          if (!isActive) return;
          setLoadingProgress((current) => Math.max(current, progress));
          setLoadingStage(stage);
        };
        const standingsRequest = codeforcesFetch('contest.standings', {
          contestId: contestId as string,
          handles: userHandles.join(';'),
          showUnofficial: 'true',
        })
          .then((response) => {
            markLoaded(LOADING_PROGRESS.standingsLoaded, 'Loading contest submissions...');
            return response;
          });
        const statusRequest = codeforcesFetch('contest.status', {
          contestId: contestId as string,
          handles: userHandles.join(';'),
        }).then((response) => {
          markLoaded(LOADING_PROGRESS.submissionsLoaded, 'Preparing replay timeline...');
          return response;
        });
        const usersRequest = codeforcesFetch('user.info', { handles: userHandles.join(';') });
        const [standingsResponse, statusResponse, usersResponse] = await Promise.all([
          standingsRequest, statusRequest, usersRequest,
        ]);
        if (!standingsResponse.ok) throw new Error('Unable to load contest standings');
        const standingsData : Standings = (await standingsResponse.json()).result;
        const isSelectedParticipant = (party: Party) => party.members
          .some((member) => userHandles.includes(member.handle));
        const selectedStandings: Standings = {
          ...standingsData,
          rows: standingsData.rows.filter((row) => isSelectedParticipant(row.party)),
        };

        if (!statusResponse.ok) throw new Error('Unable to load contest submissions');
        const allSelectedEvents: Submission[] = (await statusResponse.json()).result;
        const officialEvents = allSelectedEvents
          .filter((submission) => (
            submission.author.participantType === 'CONTESTANT'
            && submission.relativeTimeSeconds >= 0
            && submission.relativeTimeSeconds <= selectedStandings.contest.durationSeconds
          ))
          .sort((first, second) => (
            first.relativeTimeSeconds - second.relativeTimeSeconds || first.id - second.id
          ));
        setIsTruncated(officialEvents.length > MAX_SUBMISSIONS_IN_MEMORY);
        setEvents(officialEvents.slice(-MAX_SUBMISSIONS_IN_MEMORY));
        const replayStart = officialEvents.length > MAX_SUBMISSIONS_IN_MEMORY
          ? officialEvents[officialEvents.length - MAX_SUBMISSIONS_IN_MEMORY].relativeTimeSeconds : 0;
        setElapsedSeconds(getStartTime(
          getQueryValue(startTime) || getQueryValue(startMinute),
          selectedStandings.contest.durationSeconds,
          replayStart,
        ));
        setSpeed(requestedSpeed);
        setIsPlaying(getQueryValue(autoplay) === 'true');
        setFinalStandings(selectedStandings);

        if (usersResponse.ok) {
          const ranks = new Map<string, string>();
          ((await usersResponse.json()).result as User[]).forEach((user) => {
            ranks.set(user.handle, user.rank);
            ranks.set(`${user.handle} (practice)`, user.rank);
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
          finishTimer = window.setTimeout(
            () => setIsLoading(false),
            LOADING_PROGRESS.completionDelayMilliseconds,
          );
        }
      }
    };
    loadReplay();
    return () => {
      isActive = false;
      window.clearInterval(progressTimer);
      if (finishTimer) window.clearTimeout(finishTimer);
    };
  }, [autoplay, contestId, contestType, requestedSpeed, startMinute, startTime, userHandles]);

  useEffect(() => {
    if (!isPlaying || !finalStandings) return undefined;
    previousTick.current = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = ((now - (previousTick.current as number)) / 1000) * speed;
      previousTick.current = now;
      setElapsedSeconds((current) => {
        const next = Math.min(finalStandings.contest.durationSeconds, current + elapsed);
        if (next === finalStandings.contest.durationSeconds) setIsPlaying(false);
        return next;
      });
    }, REPLAY_PLAYBACK_TICK_MILLISECONDS);
    return () => window.clearInterval(timer);
  }, [finalStandings, isPlaying, speed]);

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
      setTestingSubmissions((current) => {
        const next = new Map(current);
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
        return next;
      });
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
    <div className="flex flex-col min-h-screen text-white bg-black">
      <div className="px-4 py-3 bg-gray-900 border-b border-gray-800">
        <div className="flex flex-wrap items-center gap-3 mx-auto max-w-7xl">
          <button
            className="px-4 py-2 font-semibold bg-blue-600 rounded hover:bg-blue-700"
            onClick={() => setIsPlaying((playing) => !playing)}
            type="button"
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            className="px-4 py-2 font-semibold bg-gray-700 rounded hover:bg-gray-600"
            onClick={() => { setIsPlaying(false); clearJudging(); setElapsedSeconds(replayStart); }}
            type="button"
          >
            Restart
          </button>
          <span className="font-mono text-lg">
            {formatElapsedTime(elapsedSeconds)} / {formatElapsedTime(finalStandings.contest.durationSeconds)}
          </span>
          <input
            aria-label="Replay timeline"
            className="min-w-48 grow"
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
          <label className="flex items-center gap-2">
            Speed
            <select
              className="px-2 py-1 bg-gray-800 rounded"
              onChange={(event) => setSpeed(Number(event.target.value))}
              value={speed}
            >
              {availableSpeeds.map((option) => <option key={option} value={option}>{option}×</option>)}
            </select>
          </label>
          {isTruncated && (
            <span className="text-sm text-yellow-300">
              Latest {MAX_SUBMISSIONS_IN_MEMORY.toLocaleString()} events retained
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-row min-h-0 grow">
        <div className="h-[calc(100vh-76px)] w-2/5 p-4">
          <div className="h-full overflow-hidden border border-gray-800 rounded-lg shadow-xl bg-gray-900/50">
            <LiveSubmissionsList
              submissions={cinematicSubmissions}
              newSubmissionsCount={testingSubmissions.size}
              globalStandings={snapshot.standings}
              userRank={userRank}
            />
          </div>
        </div>
        <div className="h-[calc(100vh-76px)] w-3/5 p-4">
          <div className="h-full overflow-hidden border border-gray-800 rounded-lg shadow-xl bg-gray-900/50">
            <StandingsList
              contestType={contestType as string}
              globalStandings={snapshot.standings}
              localStandings={snapshot.localStandings}
              userRank={userRank}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async () => ({ props: {} });
