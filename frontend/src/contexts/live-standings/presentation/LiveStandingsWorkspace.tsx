import { useState } from 'react';
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
  const liveStatus = isContestFinished
    ? 'Contest finished'
    : isPaused ? 'Synchronizing' : 'Connected';

  return (
    <div className="flex min-h-screen flex-col bg-[#07111f] text-white">
      <ContestRibbon
        contest={contest || globalStandings?.contest}
        contestId={contestId}
        mode="LIVE"
        status={liveStatus}
        statusTone={isContestFinished ? 'finished' : 'live'}
      />
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
      <div className="flex min-h-0 grow">
        <section
          aria-label="Live submissions"
          className={`${mobilePanel === 'submissions' ? 'flex' : 'hidden'} h-[calc(100vh-113px)] w-full p-2 lg:flex lg:h-[calc(100vh-64px)] lg:w-2/5 lg:p-3`}
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
            className={`${mobilePanel === 'standings' ? 'block' : 'hidden'} h-[calc(100vh-113px)] w-full p-2 lg:block lg:h-[calc(100vh-64px)] lg:w-3/5 lg:p-3`}
          >
            <div className="broadcast-panel h-full w-full overflow-hidden rounded-sm">
              <StandingsList
                contestType={contestType}
                globalStandings={globalStandings}
                localStandings={localStandings}
                userRank={userRank}
              />
            </div>
          </section>
        ) : (
          <div className="h-[calc(100vh-64px)] w-full p-3 lg:w-3/5">
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
