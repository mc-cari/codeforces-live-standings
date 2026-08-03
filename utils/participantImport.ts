export type ParticipantSelection = 'top' | 'random';

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
