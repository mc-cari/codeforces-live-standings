import assert from 'node:assert/strict';
import test from 'node:test';
import { completeSetup, deliver, pageMode, ViewTracker, type TelemetryEvent } from './telemetry.ts';

test('delivery retries are bounded, reuse IDs, and allow only metric fields', async () => {
  const bodies: string[] = [];
  const send = async (_: unknown, options?: RequestInit) => {
    bodies.push(String(options?.body));
    throw new Error('unavailable');
  };
  await deliver({ kind: 'page_view', mode: 'setup', handle: 'private', secret: 'credential' } as TelemetryEvent, send, async () => {});
  assert.equal(bodies.length, 3);
  assert.equal(new Set(bodies).size, 1);
  assert.deepEqual(Object.keys(JSON.parse(bodies[0])).sort(), ['id', 'kind', 'mode']);
});

test('invalid payload rejection does not retry', async () => {
  let calls = 0;
  await deliver({ kind: 'loading_failed', mode: 'live' }, async () => { calls++; return new Response(null, { status: 400 }); });
  assert.equal(calls, 1);
});

test('countdown excludes waiting, display is once across reconnects and rerenders', () => {
  const events: TelemetryEvent[] = [];
  let now = 0;
  const tracker = new ViewTracker('live', (event) => events.push(event), () => now);
  now = 1000; tracker.update(true, false);
  now = 90000; tracker.update(true, false);
  now = 101000; tracker.update(false, false);
  now = 103000; tracker.update(false, true);
  tracker.update(false, false); tracker.update(false, true);
  assert.deepEqual(events, [{ kind: 'countdown_view', mode: 'live' }, { kind: 'view_displayed', mode: 'live', seconds: 3 }]);
});

test('page classification excludes unknown routes and the miniature preview', () => {
  assert.equal(pageMode('/'), 'setup');
  assert.equal(pageMode('/contests/123/standings?h=secret'), 'live');
  assert.equal(pageMode('/contests/1735/replay?demo=true'), 'demo');
  assert.equal(pageMode('/contests/123/replay?demo=true'), 'replay');
  assert.equal(pageMode('/unknown'), undefined);
});


test('only successful navigation completes setup; canceled and rejected navigation do not', async () => {
  const events: TelemetryEvent[] = [];
  const emit = (event: TelemetryEvent) => { events.push(event); };
  await completeSetup(Promise.resolve(false), 'live', emit);
  await completeSetup(Promise.reject(new Error('canceled')), 'replay', emit);
  assert.deepEqual(events, []);
  await completeSetup(Promise.resolve(true), 'replay', emit);
  assert.deepEqual(events, [{ kind: 'setup_completed', mode: 'replay' }]);
});
