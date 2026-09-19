import { useMemo } from 'react';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import ContestLoading from '@/components/ContestLoading';
import ContestCountdown from '@/components/ContestCountdown';
import { getHandlesFromQuery } from '@/src/shared/domain/participantHandles';
import LiveStandingsWorkspace from './LiveStandingsWorkspace';
import { useContestDetails } from './useContestDetails';
import { useLiveStandingsFeed } from './useLiveStandingsFeed';

const queryString = (value: string | string[] | undefined) => (
  typeof value === 'string' ? value : undefined
);

export default function LiveStandingsPage() {
  const router = useRouter();
  const { contestId, handles, contestType, h } = router.query;
  const resolvedContestId = queryString(contestId);
  const resolvedContestType = queryString(contestType);
  const userHandles = useMemo(() => getHandlesFromQuery(handles, h), [h, handles]);
  const contest = useContestDetails(resolvedContestId, userHandles);
  const feed = useLiveStandingsFeed({
    contestId: resolvedContestId,
    contestType: resolvedContestType,
    userHandles,
    isContestReady: contest.isContestReady,
    contestError: contest.contestError,
    setContestInfo: contest.setContestInfo,
  });

  if (contest.contestInfo?.phase === 'BEFORE' && !contest.isContestReady) {
    return (
      <ContestCountdown
        contest={contest.contestInfo}
        onComplete={contest.markContestReady}
      />
    );
  }

  if (feed.isLoading) {
    return <ContestLoading progress={feed.loadingProgress} stage={feed.loadingStage} />;
  }

  return (
    <LiveStandingsWorkspace
      contest={contest.contestInfo}
      contestId={resolvedContestId ?? ''}
      contestType={resolvedContestType ?? ''}
      globalStandings={feed.globalStandings}
      isContestFinished={feed.isContestFinished}
      isPaused={feed.isPaused}
      isUpdateStale={feed.isUpdateStale}
      localStandings={feed.localStandings}
      newSubmissionsCount={feed.newSubmissionsCount}
      submissions={feed.submissions}
      userRank={contest.userRank}
    />
  );
}

export const getServerSideProps: GetServerSideProps = async () => ({ props: {} });
