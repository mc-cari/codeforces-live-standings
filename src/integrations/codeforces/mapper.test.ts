import assert from 'node:assert/strict';
import test from 'node:test';
import type { CodeforcesStandingsDto } from './contracts.ts';
import { mapStandingsDto } from './mapper.ts';

test('maps Codeforces standings into an isolated domain snapshot', () => {
  const dto = {
    contest: { id: 1, name: 'Round', type: 'CF', phase: 'CODING', durationSeconds: 7_200 },
    problems: [{ index: 'A', tags: ['math'] }],
    rows: [{
      party: { members: [{ handle: 'Tourist', name: 'Tourist' }] },
      problemResults: [{ points: 500 }],
    }],
  } as CodeforcesStandingsDto;
  const mapped = mapStandingsDto(dto);

  mapped.problems[0].tags.push('implementation');
  mapped.rows[0].party.members[0].handle = 'Changed';

  assert.deepEqual(dto.problems[0].tags, ['math']);
  assert.equal(dto.rows[0].party.members[0].handle, 'Tourist');
});
