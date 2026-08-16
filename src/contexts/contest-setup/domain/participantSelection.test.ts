import assert from 'node:assert/strict';
import test from 'node:test';
import type { Party, RanklistRow } from '../../../shared/domain/contest.ts';
import {
  normalizeImportedHandles,
  normalizeParticipantHandles,
  selectParticipantHandles,
} from './participantSelection.ts';

test('normalizes participant identity case-insensitively while preserving display spelling', () => {
  assert.deepEqual(
    normalizeParticipantHandles([' Tourist ', 'tourist', 'Benq'], ['BENQ']),
    ['Tourist'],
  );
});

test('normalizes and deduplicates friend handles returned by Codeforces', () => {
  assert.deepEqual(normalizeImportedHandles([' alice ', 'bob', 'alice', '']), ['alice', 'bob']);
});

test('rejects malformed friend lists', () => {
  assert.throws(() => normalizeImportedHandles(['alice', 42]), /invalid friend list/);
});

const row = (handle: string, participantType: string): RanklistRow => ({
  party: {
    members: [{ handle, name: handle }],
    participantType,
  } as Party,
} as RanklistRow);

const getHandle = (party: Party) => party.members[0].handle;

test('top imports preserve the supplied standings order', () => {
  const rows = [
    row('rated-first', 'CONTESTANT'),
    row('rated-second', 'CONTESTANT'),
  ];

  assert.deepEqual(
    selectParticipantHandles(rows, 2, 'top', getHandle),
    ['rated-first', 'rated-second'],
  );
});

test('random imports select the requested number of participants', () => {
  const rows = [
    row('rated-first', 'CONTESTANT'),
    row('rated-second', 'CONTESTANT'),
    row('rated-third', 'CONTESTANT'),
  ];
  const randomValues = [0.2, 0.1, 0.3];

  assert.deepEqual(
    selectParticipantHandles(
      rows,
      2,
      'random',
      getHandle,
      () => randomValues.shift() ?? 0,
    ),
    ['rated-second', 'rated-first'],
  );
});
