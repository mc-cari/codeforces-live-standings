import assert from 'node:assert/strict';
import test from 'node:test';
import RequestCoordinator, { RequestQueueCapacityError } from './requestCoordinator.ts';

test('deduplicates identical in-flight requests', async () => {
  let calls = 0;
  const coordinator = new RequestCoordinator(0);
  const request = () => coordinator.run('same', async () => {
    calls += 1;
    await Promise.resolve();
    return 'response';
  });
  assert.deepEqual(await Promise.all([request(), request()]), ['response', 'response']);
  assert.equal(calls, 1);
});

test('rejects distinct requests at capacity while preserving deduplication', async () => {
  let releaseFirst: (value: string) => void = () => undefined;
  const coordinator = new RequestCoordinator(
    0,
    Date.now,
    undefined,
    false,
    undefined,
    false,
    undefined,
    undefined,
    30_000,
    1,
  );
  const first = coordinator.run('first', () => new Promise<string>((resolve) => {
    releaseFirst = resolve;
  }));

  assert.equal(coordinator.run('first', async () => 'duplicate'), first);
  await assert.rejects(
    coordinator.run('second', async () => 'rejected'),
    RequestQueueCapacityError,
  );

  releaseFirst('first');
  assert.equal(await first, 'first');
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.equal(await coordinator.run('second', async () => 'accepted'), 'accepted');
});

test('spaces different upstream requests', async () => {
  let now = 1_000;
  const waits: number[] = [];
  const coordinator = new RequestCoordinator(2_100, () => now, async (milliseconds) => {
    waits.push(milliseconds);
    now += milliseconds;
  });
  await Promise.all([
    coordinator.run('one', async () => 'one'),
    coordinator.run('two', async () => 'two'),
  ]);
  assert.deepEqual(waits, [2_100]);
});

test('continues processing after a failed request', async () => {
  const coordinator = new RequestCoordinator(0);
  await assert.rejects(coordinator.run('failure', async () => { throw new Error('boom'); }));
  assert.equal(await coordinator.run('success', async () => 'ok'), 'ok');
});

test('starts a second request before the first response finishes', async () => {
  let releaseFirst: (value: string) => void = () => undefined;
  let secondStarted = false;
  const coordinator = new RequestCoordinator(0);
  const first = coordinator.run('first', () => new Promise<string>((resolve) => {
    releaseFirst = resolve;
  }));
  const second = coordinator.run('second', async () => {
    secondStarted = true;
    return 'second';
  });

  assert.equal(await second, 'second');
  assert.equal(secondStarted, true);
  releaseFirst('first');
  assert.equal(await first, 'first');
});

test('does not wait for response downloads before starting later requests', async () => {
  const started: string[] = [];
  const releases = new Map<string, () => void>();
  const coordinator = new RequestCoordinator(0);
  const request = (key: string) => coordinator.run(key, () => new Promise<string>((resolve) => {
    started.push(key);
    releases.set(key, () => resolve(key));
  }));
  const first = request('first');
  const second = request('second');
  const third = request('third');

  await new Promise((resolve) => { setImmediate(resolve); });
  assert.deepEqual(started, ['first', 'second', 'third']);

  releases.get('first')?.();
  releases.get('second')?.();
  releases.get('third')?.();
  assert.deepEqual(await Promise.all([first, second, third]), ['first', 'second', 'third']);
});

test('emits sanitized request lifecycle logs only when debug logging is enabled', async () => {
  const logs: Array<{ message: string; context: Record<string, unknown> }> = [];
  const logger = (message: string, context: Record<string, unknown>) => {
    logs.push({ message, context });
  };
  const coordinator = new RequestCoordinator(0, Date.now, async () => undefined, true, logger);

  await coordinator.run('user.info?handles=private-handle', async () => 'ok');

  assert.deepEqual(logs.map((entry) => entry.message), [
    'Codeforces request started.',
    'Codeforces request completed.',
  ]);
  assert.equal(logs[0].context.method, 'user.info');
  assert.equal(JSON.stringify(logs).includes('private-handle'), false);

  const disabledLogs: string[] = [];
  const productionCoordinator = new RequestCoordinator(
    0,
    Date.now,
    async () => undefined,
    false,
    (message) => disabledLogs.push(message),
  );
  await productionCoordinator.run('contest.standings?contestId=1797', async () => 'ok');
  assert.deepEqual(disabledLogs, []);
});

test('emits only slow and failed request outcomes in production', async () => {
  let now = 1_000;
  const warnings: Array<{ message: string; context: Record<string, unknown> }> = [];
  const errors: Array<{ message: string; context: Record<string, unknown> }> = [];
  const coordinator = new RequestCoordinator(
    0,
    () => now,
    async () => undefined,
    false,
    () => undefined,
    true,
    (message, context) => warnings.push({ message, context }),
    (message, context) => errors.push({ message, context }),
    30_000,
  );

  await coordinator.run('contest.standings?contestId=1797', async () => {
    now += 30_001;
    return 'slow response';
  });
  await assert.rejects(coordinator.run('user.info?handles=private-handle', async () => {
    throw new Error('socket closed');
  }));

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].message, 'Codeforces request completed slowly.');
  assert.equal(warnings[0].context.method, 'contest.standings');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'Codeforces request failed.');
  assert.equal(errors[0].context.method, 'user.info');
  assert.equal(JSON.stringify([...warnings, ...errors]).includes('private-handle'), false);
});
