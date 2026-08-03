import assert from 'node:assert/strict';
import test from 'node:test';
import { selectParticipantHandles } from './participantImport.ts';

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
