import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FAILURE_CACHE_DURATION_MILLISECONDS,
  getResponseCacheDuration,
  isSuccessfulCodeforcesResponse,
} from './responseCachePolicy.ts';

const success = { body: JSON.stringify({ status: 'OK', result: [] }), status: 200 };

test('recognizes successful Codeforces responses', () => {
  assert.equal(isSuccessfulCodeforcesResponse(success), true);
});

test('rejects HTTP failures and Codeforces API failures as successful responses', () => {
  assert.equal(isSuccessfulCodeforcesResponse({ body: '{}', status: 503 }), false);
  assert.equal(isSuccessfulCodeforcesResponse({
    body: JSON.stringify({ status: 'FAILED', comment: 'rate limit' }),
    status: 200,
  }), false);
  assert.equal(isSuccessfulCodeforcesResponse({ body: 'not json', status: 200 }), false);
});

test('uses the normal duration only for successful responses', () => {
  assert.equal(getResponseCacheDuration(60_000, success), 60_000);
  assert.equal(
    getResponseCacheDuration(60 * 60 * 1000, {
      body: JSON.stringify({
        status: 'FAILED',
        comment: 'handles: User with handle unknown not found',
      }),
      status: 400,
    }),
    FAILURE_CACHE_DURATION_MILLISECONDS,
  );
});

test('does not negative-cache transient or malformed failures', () => {
  assert.equal(
    getResponseCacheDuration(60 * 60 * 1000, {
      body: JSON.stringify({ status: 'FAILED', comment: 'Call limit exceeded' }),
      status: 200,
    }),
    undefined,
  );
  assert.equal(
    getResponseCacheDuration(60 * 60 * 1000, { body: '{}', status: 502 }),
    undefined,
  );
  assert.equal(
    getResponseCacheDuration(60 * 60 * 1000, {
      body: JSON.stringify({ status: 'FAILED', comment: 'temporary failure' }),
      status: 429,
    }),
    undefined,
  );
  assert.equal(
    getResponseCacheDuration(60 * 60 * 1000, { body: 'not json', status: 400 }),
    undefined,
  );
});
