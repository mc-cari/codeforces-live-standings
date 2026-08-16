import React, {
  useState, useEffect, useMemo, useRef,
} from 'react';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import type {
  CodeforcesContestDto,
  CodeforcesStandingsDto,
  CodeforcesSubmissionDto,
} from '@/src/integrations/codeforces/contracts';
import StandingsList from '@/components/standings/StandingsList';
import LiveSubmissionsList from '@/components/LiveSubmissionsList';
import ContestLoading from '@/components/ContestLoading';
import ContestCountdown from '@/components/ContestCountdown';
import useInterval from '@/hooks/useInterval';
import {
  LIVE_POLLING, LOADING_PROGRESS,
} from '@/src/shared/config/contestTiming';
import { getHandlesFromQuery } from '@/src/shared/domain/participantHandles';
import { projectLiveUpdate } from '../domain/projectLiveUpdate';
import { codeforcesLiveContestGateway } from '../infrastructure/codeforcesLiveContestGateway';

export default function LiveStandingsPage() {
  const [submissions, setSubmissions] = useState<CodeforcesSubmissionDto[]>([]);
  const [newSubmissionsCount, setNewSubmissionsCount] = useState<number>(0);
  const [userRank, setUserRank] = useState<Map<string, string>>(new Map<string, string>());
  const [localStandings, setLocalStandings] = useState<Map<string, number>>();
  const [globalStandings, setGlobalStandings] = useState<CodeforcesStandingsDto>();
  const [delay, setDelay] = useState<number>(LIVE_POLLING.initialDelayMilliseconds);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(8);
  const [loadingStage, setLoadingStage] = useState('Preparing live standings...');
  const [contestInfo, setContestInfo] = useState<CodeforcesContestDto>();
  const [isContestReady, setIsContestReady] = useState(false);
  const [isContestFinished, setIsContestFinished] = useState(false);
  const hasLoadedInitialData = useRef(false);
  const activeRequest = useRef<AbortController | undefined>(undefined);
  const submissionsRef = useRef<CodeforcesSubmissionDto[]>([]);

  const Router = useRouter();
  const {
    contestId, handles, contestType, h,
  } = Router.query;
  const userHandles = useMemo(() => getHandlesFromQuery(handles, h), [h, handles]);

  const fetchSubmissions = async () => {
    const isInitialLoad = !hasLoadedInitialData.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;

    try {
      if (isInitialLoad) setLoadingStage('Loading contest data...');
      const submissionsRequest = codeforcesLiveContestGateway.getSubmissions(
        contestId as string,
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
        contestId as string,
        controller.signal,
      ).then((result) => {
        if (isInitialLoad) {
          setLoadingProgress((current) => Math.max(current, LOADING_PROGRESS.standingsLoaded));
          setLoadingStage('Loading live submissions...');
        }
        return result;
      });
      const [officialStandings, remoteSubmissions] = await Promise.all([
        standingsRequest, submissionsRequest,
      ]);
      if (controller.signal.aborted) return;
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
      if (isInitialLoad) {
        hasLoadedInitialData.current = true;
        setLoadingProgress(LOADING_PROGRESS.complete);
        window.setTimeout(() => setIsLoading(false), LOADING_PROGRESS.completionDelayMilliseconds);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (isInitialLoad) setLoadingStage('Unable to load contest data');
    }
  };

  useEffect(() => {
    if (!contestId) return undefined;
    const controller = new AbortController();
    const fetchContestInfo = async () => {
      try {
        const detectedContest = await codeforcesLiveContestGateway.getContest(
          contestId as string,
          controller.signal,
        );
        setContestInfo(detectedContest);
        setIsContestReady(detectedContest.phase !== 'BEFORE');
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadingStage(error instanceof Error ? error.message : 'Unable to load contest');
        }
      }
    };
    fetchContestInfo();
    return () => {
      controller.abort();
      activeRequest.current?.abort();
    };
  }, [contestId]);

  useEffect(() => {
    if (!isLoading) return undefined;
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
    return () => window.clearInterval(progressTimer);
  }, [isLoading]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDelay(LIVE_POLLING.refreshDelayMilliseconds);
    }, LIVE_POLLING.refreshDelayMilliseconds);
    const controller = new AbortController();

    const fetchUsersRank = async () => {
      try {
        const usersInfo = await codeforcesLiveContestGateway.getUsers(
          userHandles,
          controller.signal,
        );

        const userRankMap = new Map<string, string>();
        usersInfo.forEach((user) => {
          userRankMap.set(user.handle, user.rank);
          userRankMap.set(`${user.handle} (practice)`, user.rank);
        });
        setUserRank(userRankMap);
      } catch {
        // Rank colors are supplementary; standings remain usable without them.
      }
    };
    if (userHandles.length > 0) {
      fetchUsersRank();
    }

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [userHandles]);

  useInterval(async () => {
    setIsPaused(true);

    if (contestId && userHandles.length > 0 && contestType) {
      await fetchSubmissions();
    }

    setIsPaused(false);
  }, isPaused || !isContestReady || isContestFinished ? null : delay);

  if (contestInfo?.phase === 'BEFORE' && !isContestReady) {
    return (
      <ContestCountdown
        contest={contestInfo}
        onComplete={() => setIsContestReady(true)}
      />
    );
  }

  if (isLoading) {
    return <ContestLoading progress={loadingProgress} stage={loadingStage} />;
  }

  return (
    <div className="flex flex-row bg-black text-white min-h-screen">
      <div className="flex h-screen w-2/5 p-4">
        <div className="w-full bg-gray-900/50 rounded-lg border border-gray-800 shadow-xl overflow-hidden">
          <LiveSubmissionsList
            submissions={submissions}
            newSubmissionsCount={newSubmissionsCount}
            globalStandings={globalStandings}
            userRank={userRank}
          />
        </div>
      </div>
      {(localStandings && globalStandings) ? (
        <div className="h-screen w-3/5 p-4">
          <div className="w-full h-full bg-gray-900/50 rounded-lg border border-gray-800 shadow-xl overflow-hidden">
            <StandingsList
              localStandings={localStandings}
              globalStandings={globalStandings}
              contestType={(contestType as string)}
              userRank={userRank}
            />
          </div>
        </div>
      ) : (
        <div className="h-screen w-3/5 p-4">
          <div
            className={
              'flex items-center justify-center h-full bg-gray-900/50 rounded-lg '
              + 'border border-gray-800 shadow-xl'
            }
          >
            <div className="text-center">
              <div
                className={
                  'inline-block animate-spin rounded-full h-16 w-16 border-t-2 '
                  + 'border-b-2 border-blue-500 mb-4'
                }
              />
              <h1 className="text-3xl font-semibold text-gray-300">
                Loading Contest Data...
              </h1>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async () => ({ props: {} });
