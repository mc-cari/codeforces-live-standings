import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeHandles, getHandlesFromQuery, normalizeHandles } from './participantHandles.ts';

test('normalizes and round-trips participant handles', () => {
  assert.deepEqual(normalizeHandles([' Tourist ', 'tourist', 'Benq']), ['Tourist', 'Benq']);
  const encoded = encodeHandles(['Tourist', 'Benq']);
  assert.deepEqual(getHandlesFromQuery(undefined, encoded), ['Tourist', 'Benq']);
});
