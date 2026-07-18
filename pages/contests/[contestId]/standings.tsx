import React, {
  useState, useEffect, useMemo, useRef,
} from 'react';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import StandingsList from '../../../components/standings/StandingsList';
import LiveSubmissionsList from '../../../components/LiveSubmissionsList';
import ContestLoading from '../../../components/ContestLoading';
import useInterval from '../../../hooks/useInterval';
import getName from '../../../utils/getName';
import codeforcesFetch from '../../../utils/codeforcesFetch';
import {
  LIVE_POLLING, LOADING_PROGRESS, MAX_SUBMISSIONS_IN_MEMORY,
} from '../../../utils/constants';
import { getHandlesFromQuery } from '../../../utils/handlesQuery';

export default function Standings() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [newSubmissionsCount, setNewSubmissionsCount] = useState<number>(0);
  const [userRank, setUserRank] = useState<Map<string, string>>(new Map<string, string>());
  const [localStandings, setLocalStandings] = useState<Map<string, number>>();
  const [globalStandings, setGlobalStandings] = useState<Standings>();
  const [delay, setDelay] = useState<number>(LIVE_POLLING.initialDelayMilliseconds);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(8);
  const [loadingStage, setLoadingStage] = useState('Preparing live standings...');
  const hasLoadedInitialData = useRef(false);

  const Router = useRouter();
  const {
    contestId, handles, contestType, h,
  } = Router.query;
  const userHandles = useMemo(() => getHandlesFromQuery(handles, h), [h, handles]);

  const isSubmissionAuthorInUsers = (author : Party) :
  Boolean => author.members.reduce((inUsers, user) => inUsers
  || userHandles.includes(user.handle), false);

  const fetchSubmissions = async () => {
    const problemsForUser = new Map<string, Set<string>>();
    const standingForUser = new Map<string, number>();
    const isInitialLoad = !hasLoadedInitialData.current;

    try {
      if (isInitialLoad) setLoadingStage('Loading contest data...');
      userHandles.forEach((user) => {
        standingForUser.set(user, userHandles.length);
      });

      const standingsRequest = codeforcesFetch('contest.standings', {
        contestId: contestId as string,
      }).then((response) => {
        if (isInitialLoad) {
          setLoadingProgress((current) => Math.max(current, LOADING_PROGRESS.standingsLoaded));
          setLoadingStage('Loading live submissions...');
        }
        return response;
      });
      const submissionsRequest = codeforcesFetch('contest.status', {
        contestId: contestId as string,
        handles: userHandles.join(';'),
      }).then((response) => {
        if (isInitialLoad) {
          setLoadingProgress((current) => Math.max(current, LOADING_PROGRESS.submissionsLoaded));
          setLoadingStage('Preparing live standings...');
        }
        return response;
      });
      const [standingsResponse, submissionsResponse] = await Promise.all([
        standingsRequest, submissionsRequest,
      ]);

      if (!standingsResponse.ok) {
        throw new Error('Failed to fetch standings data');
      }

      const standingsPromise = await standingsResponse.json();
      const standings : Standings = {
        ...standingsPromise.result,
        rows: standingsPromise.result.rows.filter((row: RanklistRow) => (
          isSubmissionAuthorInUsers(row.party)
        )),
      };

      let prevRank = -1; let
        prevPosition = -1;
      const userWithStandingSet = new Set<string>();
      standings.rows.forEach((row, i) => {
        let position = i + 1;
        if (row.rank === prevRank) {
          position = prevPosition;
        }
        if (!userWithStandingSet.has(getName(row.party))) {
          standingForUser.set(getName(row.party), position);
          userWithStandingSet.add(getName(row.party));
        }

        prevRank = row.rank;
        prevPosition = position;
      });

      if (!submissionsResponse.ok) {
        throw new Error('Failed to fetch submissions data');
      }
      const submissionsPromise = await submissionsResponse.json();
      const newSubmissions : Submission[] = submissionsPromise.result.reverse();

      const oldSubmissions : Submission[] = submissions.slice(0).reverse();
      let oldId = 0; let
        newSubmissionsCountUpdate = 0;
      newSubmissions.forEach((submission) => {
        if (isSubmissionAuthorInUsers(submission.author)) {
          while (oldId < oldSubmissions.length && oldSubmissions[oldId].id !== submission.id) {
            oldId += 1;
          }
          if (oldId === oldSubmissions.length) {
            newSubmissionsCountUpdate += 1;
            oldSubmissions.push(submission);
          } else { oldSubmissions[oldId] = submission; }
        }
      });

      oldSubmissions.forEach((submission) => {
        if (isSubmissionAuthorInUsers(submission.author)) {
          if (!problemsForUser.has(getName(submission.author))) {
            problemsForUser.set(getName(submission.author), new Set<string>());
          }

          if (submission.verdict === 'OK') {
            problemsForUser.get(getName(submission.author))?.add(submission.problem.index);
          }

          submission.numberOfProblems = problemsForUser.get(getName(submission.author))
            ?.size as number;
          submission.author.rank = standingForUser.get(getName(submission.author)) as number;
        }
      });
      setNewSubmissionsCount(() => Math.min(newSubmissionsCountUpdate, MAX_SUBMISSIONS_IN_MEMORY));

      setSubmissions(() => oldSubmissions.reverse().slice(0, MAX_SUBMISSIONS_IN_MEMORY));

      setGlobalStandings(standings);
      setLocalStandings(standingForUser);
      if (isInitialLoad) {
        hasLoadedInitialData.current = true;
        setLoadingProgress(LOADING_PROGRESS.complete);
        window.setTimeout(() => setIsLoading(false), LOADING_PROGRESS.completionDelayMilliseconds);
      }
    } catch (error) {
      console.log(error);
      if (isInitialLoad) setLoadingStage('Unable to load contest data');
    }
  };

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

    const fetchUsersRank = async () => {
      try {
        const usersInfoResponse = await codeforcesFetch('user.info', {
          handles: userHandles.join(';'),
        });

        if (!usersInfoResponse.ok) {
          throw new Error('Failed to fetch standings data');
        }

        const usersInfoPromise = await usersInfoResponse.json();
        const usersInfo : User[] = usersInfoPromise.result;

        const userRankMap = new Map<string, string>();
        usersInfo.forEach((user) => {
          userRankMap.set(user.handle, user.rank);
          userRankMap.set(`${user.handle} (practice)`, user.rank);
        });
        setUserRank(userRankMap);
      } catch (error) {
        console.log(error);
      }
    };
    if (userHandles.length > 0) {
      fetchUsersRank();
    }

    return () => clearTimeout(timer);
  }, [userHandles]);

  useInterval(async () => {
    setIsPaused(true);

    if (contestId && userHandles.length > 0 && contestType) {
      await fetchSubmissions();
    }

    setIsPaused(false);
  }, isPaused ? null : delay);

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
