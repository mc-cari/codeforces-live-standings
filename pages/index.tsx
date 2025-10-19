import React, { useState } from 'react';
import { useRouter } from 'next/router';
import getName from '../utils/getName';

export default function Home() {
  const [handleText, setHandleText] = useState<string>('');
  const [contestId, setContestId] = useState<number>();
  const [usersHandles, setUsersHandles] = useState<string[]>([]);
  const [contestType, setContestType] = useState<string>('');
  const [showForm, setShowForm] = useState<boolean>(false);

  const Router = useRouter();

  const handleStart = () => {
    if (contestId && usersHandles && usersHandles.length > 0 && contestType) {
      Router.push({
        pathname: `/contests/${contestId}/standings`,
        query: {
          contestType,
          handles: usersHandles,
        },
      });
    }
  };

  const addHandles = (newHandles : string[]) => {
    newHandles = newHandles.map((handle) => handle.trim());
    newHandles = newHandles.filter((handle) => !usersHandles.includes(handle));

    if (newHandles.length > 0) {
      setUsersHandles((oldUsers) => [...oldUsers, ...newHandles]);
    }
  };

  const addInputHandles = () => {
    const handles = handleText.split(',');
    addHandles(handles);

    setHandleText('');
  };

  const importHandles = async () => {
    try {
      if (!contestId) {
        throw new Error('Contest Id not set');
      }

      const standingsResponse = await fetch(
        `${process.env.CF_API}contest.standings?contestId=${contestId}&count=65&showUnofficial=true`,
        { mode: 'cors' },
      );

      if (!standingsResponse.ok) {
        throw new Error('Failed to fetch standings data');
      }

      const standingsPromise = await standingsResponse.json();
      const standings : Standings = standingsPromise.result;

      const contestHandles : string[] = standings.rows.map((row) => getName(row.party));

      addHandles(contestHandles);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log(error);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-black">
      <div className="flex-grow">
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 to-purple-600/20" />
          <div className="relative px-4 py-24 mx-auto max-w-7xl sm:px-6 lg:px-8">
            <div className="text-center">
              <h1 className="mb-6 text-5xl font-bold tracking-tight text-white md:text-7xl">
                Codeforces
                <span className="text-transparent bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text">
                  {' '}
                  Live Standings
                </span>
              </h1>
              <p
                className="max-w-3xl mx-auto mb-8 text-xl leading-relaxed text-gray-300 md:text-2xl"
              >
                Visualization for live standings of Codeforces competitions
                {' '}
                with ICPC broadcast overlay design.
                {' '}
                Track your current contest with selected participants in real-time or check any past contest.
                {' '}
                with automatic updates.
              </p>
              <div className="flex flex-col justify-center gap-4 sm:flex-row">
                <button
                  onClick={() => setShowForm(true)}
                  className={
                    'px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 '
                    + 'text-white font-semibold rounded-lg hover:from-blue-700 '
                    + 'hover:to-purple-700 transition-all duration-300 '
                    + 'transform hover:scale-105 shadow-lg'
                  }
                  type="button"
                >
                  Get Started
                </button>
                <a
                  href={
                    'https://codeforces-live-standings.vercel.app/contests/1797/standings'
                    + '?contestType=normal&handles=Maruzensky&handles=shell_wataru'
                    + '&handles=noahhb&handles=FedeNQ'
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className={
                    'px-8 py-4 border-2 border-gray-600 text-white '
                    + 'font-semibold rounded-lg hover:border-blue-400 '
                    + 'hover:text-blue-400 transition-all duration-300'
                  }
                >
                  View Demo
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className="py-20 bg-gray-900/50">
          <div className="px-4 mx-auto max-w-7xl sm:px-6 lg:px-8">
            <div className="mb-16 text-center">
              <h2 className="mb-4 text-4xl font-bold text-white">Features</h2>
              <p className="text-xl text-gray-400">
                Everything you need for competitive programming contests
              </p>
            </div>

            <div className="grid gap-8 md:grid-cols-3">
              <div
                className={
                  'bg-gray-800/50 p-8 rounded-xl border border-gray-700 '
                  + 'hover:border-blue-500/50 transition-all duration-300'
                }
              >
                <div
                  className={
                    'w-12 h-12 bg-gradient-to-r from-green-500 to-emerald-500 '
                    + 'rounded-lg mb-6 flex items-center justify-center'
                  }
                >
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                </div>
                <h3 className="mb-4 text-xl font-semibold text-white">Real-time Updates</h3>
                <p className="text-gray-400">
                  Automatic submission tracking and standings updates during live contests
                </p>
              </div>

              <div
                className={
                  'bg-gray-800/50 p-8 rounded-xl border border-gray-700 '
                  + 'hover:border-blue-500/50 transition-all duration-300'
                }
              >
                <div
                  className={
                    'w-12 h-12 bg-gradient-to-r from-blue-500 to-cyan-500 '
                    + 'rounded-lg mb-6 flex items-center justify-center'
                  }
                >
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d={
                        'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 '
                        + '002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 '
                        + '2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 '
                        + '2 0 01-2-2z'
                      }
                    />
                  </svg>
                </div>
                <h3 className="mb-4 text-xl font-semibold text-white">ICPC Broadcast Overlay Design</h3>
                <p className="text-gray-400">
                  Visualization inspired by ICPC World Finals broadcast overlay that includes a
                  {' '}
                  submission queue and a standings table
                </p>
              </div>

              <div
                className={
                  'bg-gray-800/50 p-8 rounded-xl border border-gray-700 '
                  + 'hover:border-blue-500/50 transition-all duration-300'
                }
              >
                <div
                  className={
                    'w-12 h-12 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg '
                    + 'mb-6 flex items-center justify-center'
                  }
                >
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d={
                        'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126'
                        + '-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656'
                        + '.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 '
                        + '0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 '
                        + '2 0 014 0z'
                      }
                    />
                  </svg>
                </div>
                <h3 className="mb-4 text-xl font-semibold text-white">Multiple Contest Types</h3>
                <p className="text-gray-400">
                  Support for Normal Rounds, Educational Rounds, and public Gym Contests
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div
            className={
              'bg-gray-900 rounded-xl border border-gray-700 p-8 max-w-4xl w-full '
              + 'max-h-[90vh] overflow-y-auto'
            }
          >
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-3xl font-bold text-white">Setup Contest Tracking</h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-gray-400 transition-colors hover:text-white"
                type="button"
                aria-label="Close form"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="grid gap-8 md:grid-cols-2">
              <div className="space-y-6">
                <div>
                  <h3 className="mb-4 text-xl font-semibold text-white">Add Participants</h3>
                  <p className="mb-4 text-gray-400">Teams are recognized by one of their members</p>

                  <div className="flex gap-2 mb-4">
                    <input
                      className={
                        'flex-1 p-3 bg-gray-800 border border-gray-600 rounded-lg '
                        + 'text-white placeholder-gray-400 focus:border-blue-500 '
                        + 'focus:outline-none'
                      }
                      type="text"
                      value={handleText}
                      onChange={(e) => setHandleText(e.target.value)}
                      placeholder="handle1,handle2,handle3..."
                    />
                    <button
                      className="px-6 py-3 text-white transition-colors bg-blue-600 rounded-lg hover:bg-blue-700"
                      onClick={addInputHandles}
                      type="button"
                    >
                      Add
                    </button>
                  </div>

                  <div className="p-4 overflow-y-auto bg-gray-800 rounded-lg max-h-60">
                    {usersHandles.length === 0 ? (
                      <p className="py-4 text-center text-gray-500">No participants added yet</p>
                    ) : (
                      <div className="space-y-2">
                        {usersHandles.map((user) => (
                          <div key={user} className="flex items-center justify-between p-2 bg-gray-700 rounded">
                            <span className="text-white">{user}</span>
                            <button
                              className="text-red-400 transition-colors hover:text-red-300"
                              onClick={() => setUsersHandles(usersHandles.filter((userOld) => userOld !== user))}
                              type="button"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <h3 className="mb-4 text-xl font-semibold text-white">Contest Configuration</h3>

                  <div className="mb-6">
                    <label className="block mb-2 text-white" htmlFor="contest">
                      Contest ID
                    </label>
                    <p className="mb-3 text-sm text-gray-400">
                      From URL: https://codeforces.com/contest/
                      <strong>1797</strong>
                    </p>
                    <div className="flex gap-2">
                      <input
                        className={
                          'flex-1 p-3 bg-gray-800 border border-gray-600 rounded-lg '
                          + 'text-white placeholder-gray-400 focus:border-blue-500 '
                          + 'focus:outline-none'
                        }
                        type="text"
                        id="contest"
                        placeholder="1797"
                        onChange={(e) => setContestId(parseInt(e.target.value, 10))}
                      />
                      {contestId && (
                        <button
                          className="px-6 py-3 text-white transition-colors bg-green-600 rounded-lg hover:bg-green-700"
                          onClick={importHandles}
                          type="button"
                        >
                          Import Participants
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mb-6">
                    <label className="block mb-3 text-white">Contest Type</label>
                    <div className="space-y-3">
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="radio"
                          name="contestType"
                          value="normal"
                          onChange={() => setContestType('normal')}
                          className="w-4 h-4 text-blue-600 bg-gray-800 border-gray-600 focus:ring-blue-500"
                        />
                        <span className="text-white">Normal Round</span>
                      </label>
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="radio"
                          name="contestType"
                          value="educational"
                          onChange={() => setContestType('educational')}
                          className="w-4 h-4 text-blue-600 bg-gray-800 border-gray-600 focus:ring-blue-500"
                        />
                        <span className="text-white">Educational/ICPC</span>
                      </label>
                    </div>
                  </div>

                  <button
                    className={
                      `w-full py-4 rounded-lg font-semibold transition-all duration-300 ${
                        contestId && usersHandles.length > 0 && contestType
                          ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white '
                          + 'hover:from-blue-700 hover:to-purple-700 transform hover:scale-105'
                          : 'bg-gray-700 text-gray-400 cursor-not-allowed'}`
                    }
                    onClick={handleStart}
                    disabled={!contestId || usersHandles.length === 0 || !contestType}
                    type="button"
                  >
                    Start Live Tracking
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="py-8 bg-gray-900 border-t border-gray-800">
        <div className="px-4 mx-auto max-w-7xl sm:px-6 lg:px-8">
          <div className="text-center">
            <h4 className="mb-4 text-lg font-semibold text-white">Links</h4>
            <div className="flex flex-col justify-center gap-6 sm:flex-row">
              <a
                href="https://codeforces.com/blog/entry/114892"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 transition-colors hover:text-blue-400"
              >
                Codeforces Blog Post
              </a>
              <a
                href="https://codeforces.com/apiHelp"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 transition-colors hover:text-blue-400"
              >
                Codeforces API
              </a>
              <a
                href="https://www.youtube.com/live/15Wyj_-PG9I?feature=share&t=10935"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 transition-colors hover:text-blue-400"
              >
                ICPC World Finals Inspiration
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
