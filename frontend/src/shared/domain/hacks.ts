import type { PartyNameSource } from './party.ts';

export type Hack = {
  id: number;
  creationTimeSeconds: number;
  hacker: PartyNameSource;
  defender: PartyNameSource;
  problem: { index: string };
  verdict: string;
};

// Keep only public event metadata; never retain tests or judge protocols.
export const sanitizeHack = (hack: Hack): Hack => ({
  id: hack.id, creationTimeSeconds: hack.creationTimeSeconds,
  hacker: { members: hack.hacker.members.map(({ handle }) => ({ handle })),
    teamName: hack.hacker.teamName, participantType: hack.hacker.participantType },
  defender: { members: hack.defender.members.map(({ handle }) => ({ handle })),
    teamName: hack.defender.teamName, participantType: hack.defender.participantType },
  problem: { index: hack.problem.index }, verdict: hack.verdict || 'TESTING',
});

export const mergeHacks = (previous: Hack[], incoming: Hack[]) =>
  [...new Map([...previous, ...incoming].map((hack) => [hack.id, sanitizeHack(hack)])).values()];

export const selectsParty = (party: PartyNameSource, handles: string[]) => {
  const selected = new Set(handles.map((handle) => handle.toLowerCase()));
  return selected.has(party.teamName?.toLowerCase() || '')
    || party.members.some(({ handle }) => selected.has(handle.toLowerCase()));
};
export const selectsHack = (hack: Hack, handles: string[]) =>
  selectsParty(hack.hacker, handles) || selectsParty(hack.defender, handles);

export const sameParty = (first: PartyNameSource, second: PartyNameSource) =>
  first.participantType === second.participantType && (
    Boolean(first.teamName && second.teamName && first.teamName.toLowerCase() === second.teamName.toLowerCase())
    || first.members.some((member) => second.members.some((other) => member.handle.toLowerCase() === other.handle.toLowerCase()))
  );

export const hackPoints = (type: string, verdict: string) => type !== 'CF' ? 0
  : verdict === 'HACK_SUCCESSFUL' ? 100 : verdict === 'HACK_UNSUCCESSFUL' ? -50 : 0;

export const hackCoverageIncomplete = (standings: {
  contest: { phase: string };
  rows: Array<{ party: PartyNameSource; successfulHackCount: number; unsuccessfulHackCount: number }>;
}, hacks: Hack[], loaded: boolean) => !loaded || standings.contest.phase !== 'FINISHED'
  || standings.rows.some((row) => {
    const own = mergeHacks([], hacks).filter((hack) => sameParty(hack.hacker, row.party));
    return own.filter((hack) => hack.verdict === 'HACK_SUCCESSFUL').length !== (row.successfulHackCount || 0)
      || own.filter((hack) => hack.verdict === 'HACK_UNSUCCESSFUL').length !== (row.unsuccessfulHackCount || 0);
  });
