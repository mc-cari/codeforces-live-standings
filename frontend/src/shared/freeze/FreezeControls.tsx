import type { useFreeze } from './useFreeze';
import { useRef } from 'react';

export const formatFreezeTime = (seconds: number) => `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds % 3600 / 60).toString().padStart(2, '0')}`;

export default function FreezeControls({ freeze }: { freeze: ReturnType<typeof useFreeze> }) {
  const nextButton = useRef<HTMLButtonElement>(null);
  if (freeze.warning) return <p role="status" className="border-b border-[#7a5b19] bg-[#3b2c0d] px-4 py-2 text-sm text-[#ffe8a3]">{freeze.warning}</p>;
  if (freeze.cutoff === undefined) return null;
  const button = 'min-h-11 rounded-sm border border-[#7a5b19] px-3 py-2 text-sm font-semibold hover:bg-[#594314] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f3b83f] disabled:opacity-50';
  return <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#7a5b19] bg-[#3b2c0d] px-3 py-2 text-[#ffe8a3]">
    <span className="mr-auto text-sm" role="status" aria-live="polite">
      {freeze.state === 'scheduled' ? `Freezes at ${formatFreezeTime(freeze.cutoff)}`
        : freeze.state === 'unfrozen' ? 'Standings unfrozen'
          : freeze.state === 'revealed' ? 'Reveal complete'
            : freeze.state === 'revealing' ? (freeze.announcement || 'Reveal ready')
              : `Standings frozen · ${formatFreezeTime(freeze.cutoff)} from start`}
    </span>
    {freeze.waitingForJudging && freeze.state !== 'unfrozen' && <span role="status" className="text-sm">Waiting for judging</span>}
    {freeze.state !== 'unfrozen' && <>
      {freeze.canOverride && <button className={button} onClick={() => {
        freeze.revealAnyway();
        requestAnimationFrame(() => nextButton.current?.focus());
      }} type="button">Reveal anyway</button>}
      {freeze.state === 'frozen' && <button className={button} disabled={!freeze.finished} onClick={() => {
        freeze.start();
        requestAnimationFrame(() => nextButton.current?.focus());
      }} type="button">Start reveal</button>}
      {(freeze.state === 'revealing' || freeze.state === 'revealed') && <>
        <button ref={nextButton} className={button} aria-disabled={freeze.state === 'revealed'} onClick={() => {
          if (freeze.state !== 'revealed') freeze.next();
        }} type="button">Next</button>
        <button className={button} aria-disabled={freeze.state === 'revealed'} onClick={() => {
          if (freeze.state !== 'revealed') freeze.toggleAuto();
        }} type="button">{freeze.auto ? 'Pause' : 'Auto reveal'}</button>
      </>}
      <button className={button} onClick={freeze.unfreeze} type="button">Unfreeze now</button>
    </>}
    <span className="sr-only">Viewer presentation only. Source results remain available on Codeforces and in the browser.</span>
  </div>;
}
