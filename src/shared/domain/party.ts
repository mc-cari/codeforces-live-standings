import type { CodeforcesPartyDto } from '@/src/integrations/codeforces/contracts';

// The display identity is shared by standings and replay projections.

export default function getName(party : CodeforcesPartyDto) : string {
  let partyName = party.teamName ? party.teamName : party.members[0].handle;

  if (party.participantType === 'PRACTICE') {
    partyName += ' (practice)';
  }

  return partyName;
}
