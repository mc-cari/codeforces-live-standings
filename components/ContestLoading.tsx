import React from 'react';

export default function ContestLoading({ progress, stage }: { progress: number, stage: string }) {
  return (
    <div className="flex min-h-screen flex-row bg-black text-white">
      <div className="flex h-screen w-2/5 p-4">
        <div className="w-full overflow-hidden rounded-lg border border-gray-800 bg-gray-900/50 shadow-xl">
          <div
            className={
              'h-14 border-b-2 border-gray-800 bg-gradient-to-r from-blue-600 to-blue-500 '
              + 'flex items-center justify-center font-semibold text-lg tracking-wide '
              + 'shadow-lg'
            }
          >
            LIVE SUBMISSIONS
          </div>
        </div>
      </div>
      <div className="h-screen w-3/5 p-4">
        <div
          className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-800 bg-gray-900/50 shadow-xl"
        >
          <div
            className={
              'h-14 border-b-2 border-gray-800 bg-gradient-to-r from-red-600 to-red-500 '
              + 'flex items-center justify-center font-semibold text-lg tracking-wide '
              + 'shadow-lg'
            }
          >
            CURRENT STANDINGS
          </div>
          <div className="flex grow items-center justify-center px-8">
            <div className="w-full max-w-lg">
              <div className="mb-3 flex items-center justify-between text-lg">
                <span>{stage}</span>
                <span className="font-mono text-gray-400">{Math.round(progress)}%</span>
              </div>
              <div
                aria-label={stage}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={Math.round(progress)}
                className="h-3 overflow-hidden rounded-full bg-gray-800"
                role="progressbar"
              >
                <div
                  className={
                    'h-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 '
                    + 'to-blue-500 transition-all duration-500'
                  }
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
