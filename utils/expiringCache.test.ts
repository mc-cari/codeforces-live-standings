import assert from 'node:assert/strict';
import test from 'node:test';
import ExpiringCache from './expiringCache.ts';

test('returns a cached value before it expires', () => {
  let now = 1_000;
  const cache = new ExpiringCache<string>(() => now);

  cache.set('standings', 'response', 2_000);
  now = 2_999;

  assert.equal(cache.get('standings'), 'response');
  assert.equal(cache.size, 1);
});

test('removes all expired entries during the next cache operation', () => {
  let now = 1_000;
  const cache = new ExpiringCache<string>(() => now);

  cache.set('first-contest', 'large response one', 2_000);
  cache.set('second-contest', 'large response two', 2_000);
  now = 3_000;

  assert.equal(cache.get('unrelated-key'), undefined);
  assert.equal(cache.size, 0);
});

test('keeps fresh entries while removing stale entries', () => {
  let now = 1_000;
  const cache = new ExpiringCache<string>(() => now);

  cache.set('expired', 'old response', 1_000);
  now = 1_500;
  cache.set('fresh', 'new response', 2_000);
  now = 2_000;

  assert.equal(cache.get('expired'), undefined);
  assert.equal(cache.get('fresh'), 'new response');
  assert.equal(cache.size, 1);
});

test('evicts least recently used entries when the weight limit is reached', () => {
  const cache = new ExpiringCache<string>(Date.now, {
    maximumWeight: 10,
    getWeight: (value) => value.length,
  });
  cache.set('old', '12345', 10_000);
  cache.set('recent', '1234', 10_000);
  cache.get('old');
  cache.set('new', '12', 10_000);
  assert.equal(cache.get('recent'), undefined);
  assert.equal(cache.get('old'), '12345');
  assert.equal(cache.get('new'), '12');
});

test('does not retain a value larger than the total weight limit', () => {
  const cache = new ExpiringCache<string>(Date.now, {
    maximumWeight: 3,
    getWeight: (value) => value.length,
  });
  cache.set('huge', '1234', 10_000);
  assert.equal(cache.size, 0);
});
