export type ParticipantSelection = 'top' | 'random';

export const normalizeImportedHandles = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.some((handle) => typeof handle !== 'string')) {
    throw new Error('Codeforces returned an invalid friend list');
  }

  return Array.from(new Set(value.map((handle) => handle.trim()).filter(Boolean)));
};

type RandomSource = () => number;

export const selectParticipantHandles = (
  rows: RanklistRow[],
  count: number,
  selection: ParticipantSelection,
  getParticipantName: (party: Party) => string,
  random: RandomSource = Math.random,
): string[] => {
  const handles = Array.from(new Set(rows.map((row) => getParticipantName(row.party))));

  if (selection === 'top') return handles.slice(0, count);

  return handles
    .map((handle) => ({ handle, sortOrder: random() }))
    .sort((first, second) => first.sortOrder - second.sortOrder)
    .slice(0, count)
    .map(({ handle }) => handle);
};
