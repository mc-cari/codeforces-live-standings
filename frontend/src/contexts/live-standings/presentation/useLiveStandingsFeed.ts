import { hasPendingContestJudging } from '@/src/shared/domain/judging';
import { mergeHacks, selectsHack, hackCoverageIncomplete, type Hack } from '@/src/shared/domain/hacks';
import { track } from '@/src/shared/telemetry/telemetry';
import {
  useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction,
} from 'react';
import useInterval from '@/hooks/useInterval';
import type { Contest, Standings, Submission } from '@/src/shared/domain/contest';
import { LIVE_POLLING, LOADING_PROGRESS } from '@/src/shared/config/contestTiming';
import { mapContestDto, mapStandingsDto, mapSubmissionDto } from '@/src/integrations/codeforces/mapper';
import { projectLiveUpdate } from '../domain/projectLiveUpdate';
import { codeforcesLiveContestGateway } from '../infrastructure/codeforcesLiveContestGateway';
import { liveSseGateway, type LivePatch, type LiveSnapshot } from '../infrastructure/liveSseGateway';

type LiveStandingsFeedOptions = {
  contestId: string | undefined;
  contestType: string | undefined;
  userHandles: string[];
  isContestReady: boolean;
  contestError: string | undefined;
  setContestInfo: Dispatch<SetStateAction<Contest | undefined>>;
};

export type LiveStandingsFeed = {
  hacks: Hack[];
  hacksIncomplete: boolean;
  submissions: Submission[];
  newSubmissionsCount: number;
  localStandings: Map<string, number> | undefined;
  globalStandings: Standings | undefined;
  isLoading: boolean;
  loadingProgress: number;
  loadingStage: string;
  isPaused: boolean;
  isContestFinished: boolean;
  isUpdateStale: boolean;
};

export const useLiveStandingsFeed = ({
  contestId,
  contestType,
  userHandles,
  isContestReady,
  contestError,
  setContestInfo,
}: LiveStandingsFeedOptions): LiveStandingsFeed => {
  const hackSourceKey = JSON.stringify([contestId, userHandles]);
  const [hackSource, setHackSource] = useState(hackSourceKey);
  const [hacks, setHacks] = useState<Hack[]>([]);
  const [hacksLoaded, setHacksLoaded] = useState(false);
  if (hackSource !== hackSourceKey) {
    setHackSource(hackSourceKey);
    setHacks([]);
    setHacksLoaded(false);
  }
  const [remoteHacksIncomplete, setRemoteHacksIncomplete] = useState(true);
  const lastHackFetch = useRef({ key: '', time: 0 });
  const finishedHackRetrySince = useRef<number | undefined>(undefined);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [newSubmissionsCount, setNewSubmissionsCount] = useState(0);
  const [localStandings, setLocalStandings] = useState<Map<string, number>>();
  const [globalStandings, setGlobalStandings] = useState<Standings>();
  const [delay, setDelay] = useState(LIVE_POLLING.initialDelayMilliseconds);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(LOADING_PROGRESS.initial);
  const [loadingStage, setLoadingStage] = useState('Preparing live standings...');
  const [isContestFinished, setIsContestFinished] = useState(false);
  const [isUpdateStale, setIsUpdateStale] = useState(false);
  const hasLoadedInitialData = useRef(false);
  const activeRequest = useRef<AbortController | undefined>(undefined);
  const loadingCompletionTimer = useRef<number | undefined>(undefined);
  const submissionsRef = useRef<Submission[]>([]);
  const streamedSubmissionsRef = useRef<Submission[]>([]);
  const useLiveBackend = liveSseGateway.enabled();

  const applyProjection = useCallback((
    officialStandings: Standings,
    remoteSubmissions: Submission[],
    updateContestInfo = false,
  ) => {
    const projection = projectLiveUpdate(
      officialStandings,
      remoteSubmissions,
      submissionsRef.current,
      userHandles,
    );
    submissionsRef.current = projection.submissions;
    setNewSubmissionsCount(projection.newSubmissionCount);
    setSubmissions(projection.submissions);
    setGlobalStandings(projection.standings);
    setLocalStandings(projection.localStandings);
    setIsContestFinished(projection.isFinished);
    setIsUpdateStale(false);
    if (updateContestInfo) setContestInfo(projection.standings.contest);
  }, [setContestInfo, userHandles]);

  const completeInitialLoad = useCallback(() => {
    if (hasLoadedInitialData.current) return;
    hasLoadedInitialData.current = true;
    setLoadingProgress(LOADING_PROGRESS.complete);
    loadingCompletionTimer.current = window.setTimeout(() => {
      loadingCompletionTimer.current = undefined;
      setIsLoading(false);
    }, LOADING_PROGRESS.completionDelayMilliseconds);
  }, []);

  const fetchSubmissions = async () => {
    if (!contestId) return;
    const isInitialLoad = !hasLoadedInitialData.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;

    try {
      if (isInitialLoad) setLoadingStage('Loading contest data...');
      const submissionsRequest = codeforcesLiveContestGateway.getSubmissions(
        contestId,
        userHandles,
        controller.signal,
      ).then((result) => {
        if (isInitialLoad) {
          setLoadingProgress((current) => Math.max(current, LOADING_PROGRESS.submissionsLoaded));
          setLoadingStage('Preparing live standings...');
        }
        return result;
      });
      const standingsRequest = codeforcesLiveContestGateway.getStandings(
        contestId,
        controller.signal,
      ).then((result) => {
        if (isInitialLoad) {
          setLoadingProgress((current) => Math.max(current, LOADING_PROGRESS.standingsLoaded));
          setLoadingStage('Loading live submissions...');
        }
        return result;
      });
      const [officialStandings, remoteSubmissions] = await Promise.all([
        standingsRequest,
        submissionsRequest,
      ]);
      if (controller.signal.aborted) return;
      applyProjection(officialStandings, remoteSubmissions);
      if (isInitialLoad) completeInitialLoad();
    } catch {
      if (controller.signal.aborted) return;
      if (isInitialLoad) {
        track({ kind: 'loading_failed', mode: 'live' });
        setLoadingStage('Unable to load contest data');
      }
      else setIsUpdateStale(true);
    }
  };

  useEffect(() => {
    if (!isLoading) return undefined;
    const progressTimer = window.setInterval(() => {
      setLoadingProgress((current) => {
        if (current >= LOADING_PROGRESS.estimatedMaximum) return current;
        const increment = current < LOADING_PROGRESS.submissionsLoaded
          ? LOADING_PROGRESS.fastIncrement
          : LOADING_PROGRESS.slowIncrement;
        return Math.min(LOADING_PROGRESS.estimatedMaximum, current + increment);
      });
    }, LOADING_PROGRESS.tickMilliseconds);
    return () => window.clearInterval(progressTimer);
  }, [isLoading]);

  useEffect(() => {
    if (useLiveBackend) return undefined;
    const timer = window.setTimeout(() => {
      setDelay(LIVE_POLLING.refreshDelayMilliseconds);
    }, LIVE_POLLING.refreshDelayMilliseconds);
    return () => window.clearTimeout(timer);
  }, [useLiveBackend]);

  useEffect(() => () => {
    activeRequest.current?.abort();
    if (loadingCompletionTimer.current !== undefined) {
      window.clearTimeout(loadingCompletionTimer.current);
      loadingCompletionTimer.current = undefined;
    }
  }, [contestId]);

  useEffect(() => {
    if ((!isContestReady && contestError === undefined) || !useLiveBackend || !contestId || userHandles.length === 0 || !contestType) {
      return undefined;
    }
    const controller = new AbortController();
    let source: EventSource | undefined;
    streamedSubmissionsRef.current = [];

    const applySnapshot = (snapshot: LiveSnapshot) => {
      setHacks((previous) => mergeHacks(previous, snapshot.hacks || []));
      setHacksLoaded(snapshot.hacksIncomplete !== undefined);
      setRemoteHacksIncomplete(snapshot.hacksIncomplete ?? true);
      const snapshotSubmissions = snapshot.submissions.map(mapSubmissionDto);
      streamedSubmissionsRef.current = snapshotSubmissions;
      applyProjection(mapStandingsDto(snapshot.standings), snapshotSubmissions, true);
      setIsUpdateStale(snapshot.health?.state === 'stale');
      if (snapshot.health?.state === 'finished') setIsContestFinished(true);
      completeInitialLoad();
    };
    const applyPatch = (patch: LivePatch) => {
      setHacks((previous) => mergeHacks(previous, patch.hackUpserts || []));
      setHacksLoaded(patch.hacksIncomplete !== undefined);
      setRemoteHacksIncomplete(patch.hacksIncomplete ?? true);
      const current = new Map(streamedSubmissionsRef.current.map((submission) => [submission.id, submission]));
      patch.submissionUpserts.map(mapSubmissionDto).forEach((submission) => current.set(submission.id, submission));
      streamedSubmissionsRef.current = [...current.values()];
      applyProjection(mapStandingsDto(patch.standings), streamedSubmissionsRef.current, true);
      completeInitialLoad();
    };
    const handleState = (state: string, contest?: LiveSnapshot['contest']) => {
      if (contest) setContestInfo((current) => current || mapContestDto(contest));
      if (state === 'stale') setIsUpdateStale(true);
      if (state === 'finished') setIsContestFinished(true);
    };
    const connect = async () => {
      try {
        setLoadingStage('Connecting to live backend...');
        await liveSseGateway.activate(contestId, controller.signal);
        if (controller.signal.aborted) return;
        source = liveSseGateway.connect(
          contestId,
          userHandles,
          applySnapshot,
          applyPatch,
          handleState,
          () => {
            if (!hasLoadedInitialData.current) track({ kind: 'loading_failed', mode: 'live' });
            setIsUpdateStale(true);
          },
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          if (!hasLoadedInitialData.current) track({ kind: 'loading_failed', mode: 'live' });
          setLoadingStage(error instanceof Error ? error.message : 'Unable to connect to live backend');
          setIsUpdateStale(true);
        }
      }
    };

    connect();
    return () => {
      controller.abort();
      source?.close();
    };
  }, [
    applyProjection,
    isContestReady,
    contestError,
    completeInitialLoad,
    contestId,
    contestType,
    setContestInfo,
    useLiveBackend,
    userHandles,
  ]);

  const hacksIncomplete = (useLiveBackend && remoteHacksIncomplete) || !globalStandings
    || hackCoverageIncomplete(globalStandings, hacks, hacksLoaded);

  useEffect(() => { finishedHackRetrySince.current = undefined; }, [hackSourceKey]);

  useEffect(() => {
    if (useLiveBackend || !contestId || !isContestReady || (isContestFinished && !hacksIncomplete)) return;
    const controller = new AbortController();
    if (isContestFinished && finishedHackRetrySince.current === undefined) finishedHackRetrySince.current = Date.now();
    const load = async () => {
      if (finishedHackRetrySince.current !== undefined && Date.now() - finishedHackRetrySince.current >= 600_000) return;
      if (lastHackFetch.current.key === hackSourceKey && Date.now() - lastHackFetch.current.time < 30_000) return;
      lastHackFetch.current = { key: hackSourceKey, time: Date.now() };
      const finalData = isContestFinished ? Promise.all([
        codeforcesLiveContestGateway.getStandings(contestId, controller.signal),
        codeforcesLiveContestGateway.getSubmissions(contestId, userHandles, controller.signal),
      ]).then(([official, remote]) => {
        if (!controller.signal.aborted) applyProjection(official, remote, true);
      }).catch(() => {}) : Promise.resolve();
      try {
        const incoming = await codeforcesLiveContestGateway.getHacks(contestId, controller.signal);
        if (controller.signal.aborted) return;
        setHacks((previous) => mergeHacks(previous, incoming.filter((hack) => selectsHack(hack, userHandles))));
        setHacksLoaded(true);
      } catch {
        if (!controller.signal.aborted) setHacksLoaded(false);
      }
      await finalData;
    };
    // Do not restart the 30 second cadence when the phase changes.
    const timer = window.setInterval(load, 30_000);
    void load();
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [contestId, isContestReady, useLiveBackend, userHandles, isContestFinished, hackSourceKey, hacksIncomplete, applyProjection]);

  const awaitingVerdicts = hasPendingContestJudging(submissions, globalStandings?.contest.durationSeconds || 0);
  useInterval(async () => {
    setIsPaused(true);
    if (contestId && userHandles.length > 0 && contestType) await fetchSubmissions();
    setIsPaused(false);
  }, useLiveBackend || isPaused || !isContestReady || (isContestFinished && !awaitingVerdicts && !isUpdateStale) ? null
    : isContestFinished ? 30_000 : delay);

  return {
    hacks,
    hacksIncomplete,
    submissions,
    newSubmissionsCount,
    localStandings,
    globalStandings,
    isLoading,
    loadingProgress,
    loadingStage: contestError ?? loadingStage,
    isPaused,
    isContestFinished,
    isUpdateStale,
  };
};
