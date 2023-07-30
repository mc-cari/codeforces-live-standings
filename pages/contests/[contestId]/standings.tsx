import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import StandingsList from '../../../components/standings/StandingsList';
import LiveSubmissionsList from '../../../components/LiveSubmissionsList';
import useInterval from '../../../hooks/useInterval';
import getName from '../../../utils/getName';

export default function Standings() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [newSubmissionsCount, setNewSubmissionsCount] = useState<number>(0);
  const [userRank, setUserRank] = useState<Map<string, string>>(new Map<string, string>());
  const [localStandings, setLocalStandings] = useState<Map<string, number>>();
  const [globalStandings, setGlobalStandings] = useState<Standings>();
  const [delay, setDelay] = useState<number>(100);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  const Router = useRouter();
  const { contestId, handles, contestType } = Router.query;
  const userHandles : string[] = useMemo(() => (typeof handles === 'string' ? [handles] : handles || []), [handles]);

  const isSubmissionAuthorInUsers = (author : Party) :
  Boolean => author.members.reduce((inUsers, user) => inUsers
  || userHandles.includes(user.handle), false);

  const fetchSubmissions = async () => {
    const problemsForUser = new Map<string, Set<string>>();
    const standingForUser = new Map<string, number>();

    try {
      userHandles.forEach((user) => {
        standingForUser.set(user, userHandles.length);
      });

      const standingsResponse = await fetch(
        `${process.env.CF_API}contest.standings?contestId=${contestId}&handles=${userHandles.join(';')}
        &showUnofficial=true`,
        { mode: 'cors' },
      );

      if (!standingsResponse.ok) {
        throw new Error('Failed to fetch standings data');
      }

      const standingsPromise = await standingsResponse.json();
      const standings : Standings = standingsPromise.result;

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

      const submissionsResponse = await fetch(
        `${process.env.CF_API}contest.status?contestId=${contestId}`,
        { mode: 'cors' },
      );

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
      setNewSubmissionsCount(() => newSubmissionsCountUpdate);

      setSubmissions(() => oldSubmissions.reverse().slice(0));

      setGlobalStandings(standings);
      setLocalStandings(standingForUser);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log(error);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDelay(1000);
    }, 1000);

    const fetchUsersRank = async () => {
      try {
        const usersInfoResponse = await fetch(
          `${process.env.CF_API}user.info?handles=${userHandles.join(';')}`,
          { mode: 'cors' },
        );

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
        // eslint-disable-next-line no-console
        console.log(error);
      }
    };
    if (handles) {
      fetchUsersRank();
    }

    return () => clearTimeout(timer);
  }, [handles, userHandles]);

  useInterval(async () => {
    setIsPaused(true);

    if (contestId && handles && contestType) {
      await fetchSubmissions();
    }

    setIsPaused(false);
  }, isPaused ? null : delay);

  return (
    <div className="flex flex-row bg-black text-white">
      <div className="flex h-screen w-2/5 p-5">
        <LiveSubmissionsList
          submissions={submissions}
          newSubmissionsCount={newSubmissionsCount}
          globalStandings={globalStandings}
          userRank={userRank}
        />
      </div>
      {(localStandings && globalStandings) ? (
        <div className="h-screen w-3/5 p-5">
          <StandingsList
            localStandings={localStandings}
            globalStandings={globalStandings}
            contestType={(contestType as string)}
            userRank={userRank}
          />
        </div>
      ) : (
        <div className="h-screen w-3/5 p-5">
          <div className="flex items-center justify-center h-screen">
            <h1 className="text-4xl animate-pulse">Loading...</h1>
          </div>
        </div>
      )}
    </div>
  );
}
