import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import type { ReplayStandings, ReplaySubmission } from '../../contexts/replay/domain/models';
import { nextPending, parseFreeze, projectVisible } from './projection';

export function useFreeze(standings: ReplayStandings | undefined, events: ReplaySubmission[], elapsed: number,
  finished: boolean, mode: 'live' | 'replay' = 'live', resetKey = '') {
  const router = useRouter();
  const config = parseFreeze(router.query.freezeMinutes, router.query.freezeView, standings?.contest.durationSeconds || 0);
  const identity = `${standings?.contest.id}/${config.cutoff}/${resetKey}`;
  const [progress, setProgress] = useState({ identity, revealed: new Set<string>(), started: false, auto: false, focused: '', announcement: '' });
  const current = useMemo(() => progress.identity === identity ? progress : {
    identity, revealed: new Set<string>(), started: false, auto: false, focused: '', announcement: '',
  }, [progress, identity]);
  const active = config.cutoff !== undefined && elapsed >= config.cutoff && !config.unfrozen;
  const projection = useMemo(() => standings ? projectVisible(standings, events, elapsed,
    active ? config.cutoff : undefined, current.revealed, !active && (mode === 'live' || elapsed >= standings.contest.durationSeconds)) : undefined,
  [standings, events, elapsed, active, config.cutoff, current.revealed, mode]);
  const complete = active && current.started && projection?.pending.size === 0;
  const display = complete && standings ? projectVisible(standings, events, elapsed, undefined, undefined, true) : projection;
  const next = useCallback(() => {
    if (!projection || !finished || !active) return;
    const target = nextPending(projection);
    setProgress({ ...current, started: true, revealed: target ? new Set([...current.revealed, target.key]) : current.revealed,
      focused: target?.key || '', announcement: target ? `Revealed ${target.name}, problem ${target.problem}.` : 'Reveal complete.' });
  }, [projection, finished, active, current]);
  useEffect(() => {
    if (!current.auto || complete || !active || !finished) return;
    const timer = window.setTimeout(next, 1500);
    return () => window.clearTimeout(timer);
  }, [current.auto, complete, active, finished, next]);
  return {
    ...config, projection: display, focused: active ? current.focused : '', announcement: complete ? 'Reveal complete' : current.announcement,
    state: config.unfrozen ? 'unfrozen' : !active ? 'scheduled' : complete ? 'revealed' : current.started ? 'revealing' : 'frozen',
    auto: current.auto && !complete, finished, next,
    start: () => setProgress({ ...current, started: true }),
    toggleAuto: () => setProgress({ ...current, auto: !current.auto }),
    unfreeze: () => router.replace({ pathname: router.pathname, query: { ...router.query, freezeView: 'unfrozen' } }, undefined, { shallow: true }),
  };
}
