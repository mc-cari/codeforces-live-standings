import { useEffect, useRef } from 'react';
import { ViewTracker, type Mode } from './telemetry';

export function useViewTelemetry(mode: Mode, waiting: boolean, displayed: boolean) {
  const tracker = useRef<ViewTracker | undefined>(undefined);
  useEffect(() => {
    tracker.current ??= new ViewTracker(mode);
    tracker.current.update(waiting, displayed);
  }, [mode, waiting, displayed]);
}
