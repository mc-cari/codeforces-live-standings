import type { PartyNameSource } from '@/src/shared/domain/party';
import { normalizeHandles } from '../../../shared/domain/participantHandles.ts';

export type ParticipantSelection = 'top' | 'random';
export type ParticipantSelectionRow = { party: PartyNameSource };

export const normalizeParticipantHandles = (
  handles: string[],
  existingHandles: string[] = [],
): string[] => normalizeHandles(handles, existingHandles);

export const normalizeImportedHandles = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.some((handle) => typeof handle !== 'string')) {
    throw new Error('Codeforces returned an invalid friend list');
  }

  return normalizeParticipantHandles(value);
};

type RandomSource = () => number;

export const selectParticipantHandles = (
  rows: ParticipantSelectionRow[],
  count: number,
  selection: ParticipantSelection,
  getParticipantName: (party: PartyNameSource) => string,
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
