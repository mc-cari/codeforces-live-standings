export type Mode = 'live' | 'replay' | 'demo';
export type TelemetryEvent =
  | { kind: 'page_view'; mode: Mode | 'setup' }
  | { kind: 'setup_completed'; mode: 'live' | 'replay' }
  | { kind: 'view_displayed'; mode: Mode; seconds: number }
  | { kind: 'countdown_view'; mode: 'live' }
  | { kind: 'loading_failed'; mode: Mode };

// Select only metric dimensions. Query strings, exceptions, handles and
// credentials must never enter the wire payload.
export async function deliver(
  event: TelemetryEvent,
  send: typeof fetch = fetch,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  try {
    const body = JSON.stringify({
      id: crypto.randomUUID(), kind: event.kind, mode: event.mode,
      ...(event.kind === 'view_displayed' ? { seconds: event.seconds } : {}),
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await send('/api/telemetry', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
          keepalive: true, signal: AbortSignal.timeout(4000),
        });
        if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) return;
      } catch { /* best effort; reuse the receipt ID on retry */ }
      if (attempt < 2) await sleep(250 * (2 ** attempt));
    }
  } catch { /* telemetry must never affect the application */ }
}

export function track(event: TelemetryEvent): void {
  if (process.env.NEXT_PUBLIC_TELEMETRY_ENABLED === 'true') void deliver(event);
}

export function pageMode(path: string): Mode | 'setup' | undefined {
  const url = new URL(path, 'https://local.invalid');
  if (url.pathname === '/') return 'setup';
  if (/^\/contests\/[^/]+\/standings$/.test(url.pathname)) return 'live';
  if (/^\/contests\/[^/]+\/replay$/.test(url.pathname)) {
    return url.pathname === '/contests/1735/replay' && url.searchParams.get('demo') === 'true' ? 'demo' : 'replay';
  }
  return undefined;
}

// One instance per navigation, independent of polling and SSE reconnections.
export class ViewTracker {
  private started: number;
  private pausedAt: number | undefined;
  private displayed = false;
  private countdown = false;
  private mode: Mode;
  private emit: (event: TelemetryEvent) => void;
  private now: () => number;
  constructor(mode: Mode, emit = track, now = () => performance.now()) {
    this.mode = mode; this.emit = emit; this.now = now;
    this.started = now();
  }
  update(waiting: boolean, displayed: boolean): void {
    const now = this.now();
    if (waiting) {
      if (!this.countdown) { this.emit({ kind: 'countdown_view', mode: 'live' }); this.countdown = true; }
      this.pausedAt ??= now;
      return;
    }
    if (this.pausedAt !== undefined) { this.started += now - this.pausedAt; this.pausedAt = undefined; }
    if (displayed && !this.displayed) {
      this.displayed = true;
      this.emit({ kind: 'view_displayed', mode: this.mode, seconds: Math.min(86400, Math.max(0, (now - this.started) / 1000)) });
    }
  }
}

// Next resolves false or rejects when a navigation is canceled. Only a
// committed destination completes a setup.
export async function completeSetup(navigation: Promise<boolean>, mode: 'live' | 'replay', emit = track): Promise<void> {
  try { if (await navigation) emit({ kind: 'setup_completed', mode }); } catch { /* canceled navigation */ }
}
