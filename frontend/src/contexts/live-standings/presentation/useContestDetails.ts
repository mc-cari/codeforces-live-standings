import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { Contest } from '@/src/shared/domain/contest';
import { codeforcesLiveContestGateway } from '../infrastructure/codeforcesLiveContestGateway';

type ContestDetails = {
  contestInfo: Contest | undefined;
  setContestInfo: Dispatch<SetStateAction<Contest | undefined>>;
  isContestReady: boolean;
  markContestReady: () => void;
  userRank: Map<string, string>;
  contestError: string | undefined;
};

export const useContestDetails = (
  contestId: string | undefined,
  userHandles: string[],
): ContestDetails => {
  const [contestInfo, setContestInfo] = useState<Contest>();
  const [isContestReady, setIsContestReady] = useState(false);
  const [userRank, setUserRank] = useState<Map<string, string>>(new Map());
  const [contestError, setContestError] = useState<string>();

  useEffect(() => {
    if (!contestId) return undefined;
    const controller = new AbortController();

    const fetchContestInfo = async () => {
      try {
        const detectedContest = await codeforcesLiveContestGateway.getContest(
          contestId,
          controller.signal,
        );
        setContestInfo(detectedContest);
        setIsContestReady(detectedContest.phase !== 'BEFORE');
        setContestError(undefined);
      } catch (error) {
        if (!controller.signal.aborted) {
          setContestError(error instanceof Error ? error.message : 'Unable to load contest');
        }
      }
    };

    fetchContestInfo();
    return () => controller.abort();
  }, [contestId]);

  useEffect(() => {
    if (userHandles.length === 0) return undefined;
    const controller = new AbortController();

    const fetchUsersRank = async () => {
      try {
        const users = await codeforcesLiveContestGateway.getUsers(userHandles, controller.signal);
        const ranks = new Map<string, string>();
        users.forEach((user) => {
          ranks.set(user.handle, user.rank);
          ranks.set(`${user.handle} (practice)`, user.rank);
        });
        setUserRank(ranks);
      } catch (error) {
        if (!controller.signal.aborted) {
          setUserRank(new Map());
          console.warn('Codeforces user ranks unavailable.', { error });
        }
      }
    };

    fetchUsersRank();
    return () => controller.abort();
  }, [userHandles]);

  return {
    contestInfo,
    setContestInfo,
    isContestReady,
    markContestReady: () => setIsContestReady(true),
    userRank,
    contestError,
  };
};
