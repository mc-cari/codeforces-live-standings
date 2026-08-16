import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import type { Contest } from '@/src/shared/domain/contest';
import { encodeHandles } from '@/src/shared/domain/participantHandles';
import { getContestConfiguration } from '../domain/contestConfiguration';
import {
  normalizeParticipantHandles,
  type ParticipantSelection,
} from '../domain/participantSelection';
import { findUpcomingContests } from '../domain/upcomingContests';
import { codeforcesContestSetupGateway } from '../infrastructure/codeforcesContestSetupGateway';
import MiniContestSimulation from './MiniContestSimulation';

type LookupState = 'idle' | 'loading' | 'error';

const formatContestStart = (contest: Contest) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(contest.startTimeSeconds * 1_000));

export default function ContestSetupPage() {
  const router = useRouter();
  const [contestIdInput, setContestIdInput] = useState('');
  const [contestInfo, setContestInfo] = useState<Contest>();
  const [lookupState, setLookupState] = useState<LookupState>('idle');
  const [lookupError, setLookupError] = useState('');
  const [upcomingContests, setUpcomingContests] = useState<Contest[]>([]);
  const [isLoadingUpcoming, setIsLoadingUpcoming] = useState(true);
  const [handleInput, setHandleInput] = useState('');
  const [handles, setHandles] = useState<string[]>([]);
  const [participantCount, setParticipantCount] = useState('15');
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [friendApiKey, setFriendApiKey] = useState('');
  const [friendApiSecret, setFriendApiSecret] = useState('');
  const [isImportingFriends, setIsImportingFriends] = useState(false);
  const [friendMessage, setFriendMessage] = useState('');
  const [friendError, setFriendError] = useState('');

  const contestId = Number(contestIdInput);
  const configuration = useMemo(
    () => (contestInfo ? getContestConfiguration(contestInfo) : undefined),
    [contestInfo],
  );

  useEffect(() => {
    const controller = new AbortController();
    codeforcesContestSetupGateway.listContests(controller.signal)
      .then((contests) => setUpcomingContests(findUpcomingContests(contests)))
      .catch(() => setUpcomingContests([]))
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingUpcoming(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!Number.isSafeInteger(contestId) || contestId <= 0) {
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setLookupState('loading');
        setLookupError('');
        const contest = await codeforcesContestSetupGateway.findContest(contestId, controller.signal);
        setContestInfo(contest);
        setLookupState('idle');
      } catch (error) {
        if (controller.signal.aborted) return;
        setContestInfo(undefined);
        setLookupState('error');
        setLookupError(error instanceof Error ? error.message : 'Contest not found');
      }
    }, 600);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [contestId]);

  const addHandles = (values: string[]) => {
    setHandles((current) => [
      ...current,
      ...normalizeParticipantHandles(values, current),
    ]);
  };

  const addTypedHandles = () => {
    addHandles(handleInput.split(/[,;\n\s]+/));
    setHandleInput('');
  };

  const selectContest = (contest: Contest) => {
    setContestIdInput(String(contest.id));
    setContestInfo(contest);
    setLookupState('idle');
    setLookupError('');
    setImportError('');
    setFriendError('');
    document.getElementById('contest-workspace')?.scrollIntoView({ behavior: 'smooth' });
  };

  const importParticipants = async (selection: ParticipantSelection) => {
    const count = Number(participantCount);
    if (!contestInfo) return;
    if (!Number.isSafeInteger(count) || count <= 0) {
      setImportError('Enter a participant count of at least 1.');
      return;
    }
    try {
      setIsImporting(true);
      setImportError('');
      addHandles(await codeforcesContestSetupGateway.importParticipants(contestInfo.id, count, selection));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Unable to import participants');
    } finally {
      setIsImporting(false);
    }
  };

  const importFriends = async () => {
    const apiKey = friendApiKey.trim();
    const apiSecret = friendApiSecret.trim();
    if (!apiKey || !apiSecret) {
      setFriendError('Enter both the Codeforces API key and API secret.');
      return;
    }
    try {
      setIsImportingFriends(true);
      setFriendError('');
      setFriendMessage('');
      const imported = await codeforcesContestSetupGateway.importFriends({ apiKey, apiSecret });
      addHandles(imported);
      setFriendMessage('Friend handles imported.');
    } catch (error) {
      setFriendError(error instanceof Error ? error.message : 'Unable to import friends');
    } finally {
      setIsImportingFriends(false);
      setFriendApiKey('');
      setFriendApiSecret('');
    }
  };

  const launch = () => {
    if (!contestInfo || !configuration?.contestType || handles.length === 0) return;
    router.push({
      pathname: `/contests/${contestInfo.id}/${configuration.route}`,
      query: { contestType: configuration.contestType, h: encodeHandles(handles) },
    });
  };

  return (
    <main className="min-h-screen text-[#f4f8ff]">
      <header className="border-b border-[#25364d] bg-[#07111f]/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <Link className="font-broadcast text-xl font-bold uppercase tracking-[0.08em]" href="/">
            CF <span className="text-[#65adff]">Live Desk</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm text-[#91a3ba]" aria-label="Primary navigation">
            <Link
              className="rounded-sm border border-[#2d8cff] px-3 py-2 font-semibold text-[#9fc8ff] transition-colors hover:bg-[#12315a] hover:text-white"
              href="/contests/1735/replay?contestType=normal&startTime=2%3A50&playbackSpeed=15&autoplay=true&demo=true&h=TWF0ZW9DVjttYy5fY2FyaTtkbWdhNDQ7TWFyY2tlc3M7anVsaWFuZmVycmVzO3BhY2hhMjg4MDtHaWdhX0Nyb25vczttYXJ0aW5zO21hcnRpbml1cztNYXRlbztNZXNTaW1vbkZhbGxvbjE5O1NjYW5vO0FnYXJpYztlc3RveS1yZS1zZWJhZG87VGFpbmVsO01hcmNlYW50YXN5O0FuZ3J5U2VhbA"
            >
              Replay demo
            </Link>
            <a className="hover:text-white" href="#how-it-works">How it works</a>
            <a className="hover:text-white" href="https://github.com/mc-cari/codeforces-live-standings">GitHub</a>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-12">
        <div className="mb-8 max-w-3xl">
          <p className="broadcast-label mb-3">Personal contest tracker</p>
          <h1 className="font-broadcast text-5xl font-bold uppercase leading-[0.92] tracking-tight sm:text-7xl">
            Your friends.<br /><span className="text-[#65adff]">One live scoreboard.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-[#aab8ca] sm:text-lg">
            Pick a Codeforces contest, add the handles you care about, and follow every solve,
            penalty, and position change from one broadcast-style desk.
          </p>
        </div>

        <section className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(32rem,1.08fr)]" id="contest-workspace">
          <div className="broadcast-panel rounded-md p-5 sm:p-6">
            <div className="mb-6 flex items-start justify-between gap-4 border-b border-[#25364d] pb-5">
              <div>
                <p className="broadcast-label">01 / Contest</p>
                <h2 className="font-broadcast text-3xl font-semibold uppercase">Start tracking</h2>
              </div>
              <span className={`mt-1 h-2.5 w-2.5 rounded-full ${contestInfo ? 'bg-[#21c16b]' : 'bg-[#f3b83f]'}`} />
            </div>

            <label className="mb-2 block text-sm font-medium" htmlFor="contest-id">Codeforces contest ID</label>
            <input
              className="broadcast-input px-3"
              id="contest-id"
              inputMode="numeric"
              onChange={(event) => {
                setContestIdInput(event.target.value.replace(/\D/g, ''));
                setContestInfo(undefined);
                setLookupState('idle');
                setLookupError('');
                setImportError('');
                setFriendError('');
              }}
              placeholder="For example, 1735"
              value={contestIdInput}
            />
            <div className="mt-2 min-h-6 text-sm">
              {lookupState === 'loading' && <p className="text-[#9fc8ff]">Detecting contest…</p>}
              {lookupError && <p className="text-[#ff8585]">{lookupError}</p>}
            </div>

            {contestInfo && (
              <div className="mt-2 border-l-2 border-[#2d8cff] bg-[#081525] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">{contestInfo.name}</p>
                    <p className="mt-1 text-sm text-[#91a3ba]">{formatContestStart(contestInfo)}</p>
                  </div>
                  <span className="rounded-sm bg-[#13243a] px-2 py-1 font-data text-xs text-[#9fc8ff]">
                    {contestInfo.phase}
                  </span>
                </div>
              </div>
            )}

            {contestInfo && (
              <div className="mt-7 border-t border-[#25364d] pt-6">
                <div className="mb-4">
                  <p className="broadcast-label">02 / Participants</p>
                  <h3 className="font-broadcast text-2xl font-semibold uppercase">Build your field</h3>
                </div>
                <div className="flex gap-2">
                  <input
                    className="broadcast-input px-3"
                    id="participant-handles"
                    onChange={(event) => setHandleInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') { event.preventDefault(); addTypedHandles(); }
                    }}
                    placeholder="tourist, Benq, your_handle"
                    value={handleInput}
                  />
                  <button className="broadcast-button rounded-sm px-4" onClick={addTypedHandles} type="button">Add</button>
                </div>

                <div className="mt-4 rounded-sm border border-[#25364d] bg-[#081525] p-4">
                  <label className="mb-2 block text-sm font-medium" htmlFor="participant-count">Official standings</label>
                  <div className="grid grid-cols-[5rem_1fr_1fr] gap-2">
                    <input
                      className="broadcast-input px-2 text-center font-data"
                      id="participant-count"
                      min="1"
                      onChange={(event) => setParticipantCount(event.target.value)}
                      type="number"
                      value={participantCount}
                    />
                    <button className="rounded-sm border border-[#25364d] px-2 text-sm font-medium hover:bg-[#13243a]" disabled={isImporting} onClick={() => importParticipants('top')} type="button">
                      Import top
                    </button>
                    <button className="rounded-sm border border-[#25364d] px-2 text-sm font-medium hover:bg-[#13243a]" disabled={isImporting} onClick={() => importParticipants('random')} type="button">
                      Import random
                    </button>
                  </div>
                  {importError && <p className="mt-2 text-sm text-[#ff8585]">{importError}</p>}
                </div>

                <details className="mt-3 rounded-sm border border-[#1d5f78] bg-[#08212d] p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-[#9de6ff]">Import Codeforces friends automatically</summary>
                  <div className="pt-4">
                    <p className="mb-2 text-xs leading-5 text-[#8fb8c7]">Create an API key for this import and delete it after.</p>
                    <a className="text-xs text-[#7ddfff] underline underline-offset-4" href="https://codeforces.com/settings/api" rel="noreferrer" target="_blank">Get a Codeforces API key</a>
                    <div className="mt-3 space-y-2">
                      <input aria-label="Codeforces API key" autoComplete="off" className="broadcast-input px-3 text-sm" onChange={(event) => setFriendApiKey(event.target.value)} placeholder="API key" value={friendApiKey} />
                      <input aria-label="Codeforces API secret" autoComplete="off" className="broadcast-input px-3 text-sm" onChange={(event) => setFriendApiSecret(event.target.value)} placeholder="API secret" type="password" value={friendApiSecret} />
                    </div>
                    <button className="mt-3 w-full rounded-sm border border-[#2386a8] bg-[#0c617d] px-4 py-2.5 text-sm font-semibold hover:bg-[#0e7395]" disabled={isImportingFriends} onClick={importFriends} type="button">
                      {isImportingFriends ? 'Importing…' : 'Import friend list'}
                    </button>
                    {friendMessage && <p className="mt-2 text-sm text-[#70e5a5]">{friendMessage}</p>}
                    {friendError && <p className="mt-2 text-sm text-[#ff8585]">{friendError}</p>}
                  </div>
                </details>

                <div className="mt-4 max-h-40 overflow-y-auto rounded-sm border border-[#25364d] bg-[#081525] p-2">
                  {handles.length === 0 ? (
                    <p className="p-3 text-center text-sm text-[#64758c]">Add at least one handle to continue.</p>
                  ) : handles.map((handle) => (
                    <div className="flex items-center justify-between border-b border-[#25364d]/60 px-2 py-2 last:border-0" key={handle.toLocaleLowerCase()}>
                      <span className="truncate font-data text-sm">{handle}</span>
                      <button aria-label={`Remove ${handle}`} className="px-2 text-[#ff8585] hover:text-white" onClick={() => setHandles((current) => current.filter((candidate) => candidate.toLocaleLowerCase() !== handle.toLocaleLowerCase()))} type="button">×</button>
                    </div>
                  ))}
                </div>

                <div className="mt-6">
                  <p className="broadcast-label">03 / Launch</p>
                  {configuration?.unsupportedReason && <p className="mb-2 text-sm text-[#f3b83f]">{configuration.unsupportedReason}</p>}
                  <button className="broadcast-button mt-2 w-full rounded-sm px-5 py-3" disabled={!configuration?.contestType || handles.length === 0} onClick={launch} type="button">
                    {configuration?.actionLabel || 'Choose a contest'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="lg:sticky lg:top-6">
            <MiniContestSimulation contestId={contestInfo?.id} contestName={contestInfo?.name} handles={handles} />
            <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-[#25364d] bg-[#25364d]" id="how-it-works">
              {[
                ['Choose', 'Enter any Codeforces contest ID.'],
                ['Collect', 'Add handles or import a friend list.'],
                ['Follow', 'Watch standings and submissions update.'],
              ].map(([title, copy], index) => (
                <div className="bg-[#0d1b2a] p-3" key={title}>
                  <p className="font-data text-xs text-[#65adff]">0{index + 1}</p>
                  <p className="mt-1 text-sm font-semibold text-white">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-[#91a3ba]">{copy}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-12 border-t border-[#25364d] pt-8" aria-labelledby="upcoming-heading">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="broadcast-label">Codeforces schedule</p>
              <h2 className="font-broadcast text-3xl font-semibold uppercase" id="upcoming-heading">On the grid</h2>
            </div>
            {isLoadingUpcoming && <span className="font-data text-xs text-[#91a3ba]">SYNCING…</span>}
          </div>
          {!isLoadingUpcoming && upcomingContests.length === 0 && <p className="text-[#91a3ba]">No live or upcoming contests were found.</p>}
          <div className="grid gap-3 md:grid-cols-3">
            {upcomingContests.map((contest) => (
              <button className="broadcast-panel group rounded-sm p-4 text-left hover:border-[#2d8cff]" key={contest.id} onClick={() => selectContest(contest)} type="button">
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-data text-xs text-[#65adff]">#{contest.id}</span>
                  <span className={`h-2 w-2 rounded-full ${contest.phase === 'CODING' ? 'animate-pulse bg-[#21c16b]' : 'bg-[#f3b83f]'}`} />
                </div>
                <h3 className="min-h-12 font-medium text-white group-hover:text-[#9fc8ff]">{contest.name}</h3>
                <p className="mt-3 text-sm text-[#91a3ba]">{contest.phase === 'CODING' ? 'Live now' : formatContestStart(contest)}</p>
              </button>
            ))}
          </div>
        </section>
      </div>

      <footer className="mt-10 border-t border-[#25364d] px-4 py-6 text-center text-sm text-[#64758c]">
        Built for Codeforces spectators and small contest circles.
      </footer>
    </main>
  );
}
