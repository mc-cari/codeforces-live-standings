import React from 'react';

export default function ContestLoading({ progress, stage }: { progress: number, stage: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#07111f] px-5 text-white">
      <section className="broadcast-panel w-full max-w-2xl overflow-hidden rounded-sm">
        <header className="flex items-center justify-between border-b border-[#25364d] bg-[#081525] px-5 py-4">
          <div>
            <p className="broadcast-label">Contest feed</p>
            <h1 className="font-broadcast text-2xl font-semibold uppercase">Opening live desk</h1>
          </div>
          <span className="h-2.5 w-2.5 motion-safe:animate-pulse rounded-full bg-[#2d8cff]" />
        </header>
        <div className="p-6 sm:p-10">
          <div className="mb-3 flex items-center justify-between gap-4">
            <span>{stage}</span>
            <span className="font-data text-[#91a3ba]">{Math.round(progress)}%</span>
          </div>
          <div
            aria-label={stage}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(progress)}
            className="h-2 overflow-hidden rounded-sm bg-[#13243a]"
            role="progressbar"
          >
            <div
              className="h-full bg-[#2d8cff] transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-6 grid grid-cols-5 gap-2" aria-hidden="true">
            {Array.from({ length: 5 }, (_, index) => (
              <div className="h-12 motion-safe:animate-pulse rounded-sm bg-[#13243a]" key={index} />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
