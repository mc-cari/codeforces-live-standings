import { useEffect, useState } from 'react';
import { useFreeze } from '@/src/shared/freeze/useFreeze';
import FreezeControls from '@/src/shared/freeze/FreezeControls';
import { MAX_SUBMISSIONS_IN_MEMORY } from '@/src/shared/config/contestTiming';
import StandingsList from '@/components/standings/StandingsList';
import LiveSubmissionsList from '@/components/LiveSubmissionsList';
import ContestRibbon from '@/src/shared/presentation/ContestRibbon';
import type { Contest, Standings, Submission } from '@/src/shared/domain/contest';

type MobilePanel = 'standings' | 'submissions';

type LiveStandingsWorkspaceProps = {
  contest: Contest | undefined;
  contestId: string;
  contestType: string;
  submissions: Submission[];
  newSubmissionsCount: number;
  localStandings: Map<string, number> | undefined;
  globalStandings: Standings | undefined;
  userRank: Map<string, string>;
  isPaused: boolean;
  isContestFinished: boolean;
  isUpdateStale: boolean;
};

const PANELS: MobilePanel[] = ['standings', 'submissions'];

export default function LiveStandingsWorkspace({
  contest,
  contestId,
  contestType,
  submissions,
  newSubmissionsCount,
  localStandings,
  globalStandings,
  userRank,
  isPaused,
  isContestFinished,
  isUpdateStale,
}: LiveStandingsWorkspaceProps) {
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('standings');
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const source = globalStandings;
  const elapsed = source ? (isContestFinished ? source.contest.durationSeconds
    : Math.max(source.contest.relativeTimeSeconds, now - source.contest.startTimeSeconds)) : 0;
  const freeze = useFreeze(source, submissions, elapsed, isContestFinished);
  if (freeze.cutoff !== undefined && freeze.projection) {
    globalStandings = freeze.projection.standings as Standings;
    localStandings = freeze.projection.localStandings;
    submissions = freeze.projection.submissions as Submission[];
    if (freeze.state === 'frozen' || freeze.state === 'revealing') newSubmissionsCount = 0;
  }
  submissions = submissions.slice(0, MAX_SUBMISSIONS_IN_MEMORY);
  const liveStatus = isContestFinished
    ? 'Contest finished'
    : isPaused ? 'Synchronizing' : 'Connected';

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#07111f] text-white">
      <ContestRibbon
        contest={contest || globalStandings?.contest}
        contestId={contestId}
        mode="LIVE"
        status={liveStatus}
        statusTone={isContestFinished ? 'finished' : 'live'}
      />
      <FreezeControls freeze={freeze} />
      {isUpdateStale && (
        <div className="border-b border-[#7a5b19] bg-[#3b2c0d] px-4 py-2 text-center text-sm text-[#ffe8a3]" role="status">
          Live updates are unavailable. Showing the latest standings.
        </div>
      )}
      <div className="grid grid-cols-2 border-b border-[#25364d] bg-[#0d1b2a] lg:hidden" role="tablist">
        {PANELS.map((panel) => (
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
      <div className="flex min-h-0 flex-1">
        <section
          aria-label="Live submissions"
          className={`${mobilePanel === 'submissions' ? 'flex' : 'hidden'} h-full min-h-0 w-full p-2 lg:flex lg:w-2/5 lg:p-3`}
        >
          <div className="broadcast-panel w-full overflow-hidden rounded-sm">
            <LiveSubmissionsList
              globalStandings={globalStandings}
              newSubmissionsCount={newSubmissionsCount}
              submissions={submissions}
              userRank={userRank}
            />
          </div>
        </section>
        {(localStandings && globalStandings) ? (
          <section
            aria-label="Current standings"
            className={`${mobilePanel === 'standings' ? 'block' : 'hidden'} h-full min-h-0 w-full p-2 lg:block lg:w-3/5 lg:p-3`}
          >
            <div className="broadcast-panel h-full w-full overflow-hidden rounded-sm">
              <StandingsList
                pending={freeze.projection?.pending}
                focused={freeze.focused}
                isVisible={mobilePanel === 'standings'}
                contestType={contestType}
                globalStandings={globalStandings}
                localStandings={localStandings}
                userRank={userRank}
              />
            </div>
          </section>
        ) : (
          <div className="h-full min-h-0 w-full p-3 lg:w-3/5">
            <div className="flex h-full items-center justify-center rounded-lg border border-gray-800 bg-gray-900/50 shadow-xl">
              <div className="text-center">
                <div className="mb-4 inline-block h-16 w-16 animate-spin rounded-full border-b-2 border-t-2 border-blue-500" />
                <h1 className="text-3xl font-semibold text-gray-300">Loading Contest Data...</h1>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
