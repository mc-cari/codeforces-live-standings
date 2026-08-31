import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CodeforcesPartyDto,
  CodeforcesRanklistRowDto,
} from '../src/integrations/codeforces/contracts.ts';
import { normalizeImportedHandles, selectParticipantHandles } from './participantImport.ts';

test('normalizes and deduplicates friend handles returned by Codeforces', () => {
  assert.deepEqual(normalizeImportedHandles([' alice ', 'bob', 'alice', '']), ['alice', 'bob']);
});

test('rejects malformed friend lists', () => {
  assert.throws(() => normalizeImportedHandles(['alice', 42]), /invalid friend list/);
});

const row = (handle: string, participantType: string): CodeforcesRanklistRowDto => ({
  party: {
    members: [{ handle, name: handle }],
    participantType,
  } as CodeforcesPartyDto,
} as CodeforcesRanklistRowDto);

const getHandle = (party: CodeforcesPartyDto) => party.members[0].handle;

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
