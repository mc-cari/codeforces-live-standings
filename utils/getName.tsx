import type { CodeforcesPartyDto } from '@/src/integrations/codeforces/contracts';

export default function getName(party : CodeforcesPartyDto) : string {
  let partyName = party.teamName ? party.teamName : party.members[0].handle;

  if (party.participantType === 'PRACTICE') {
    partyName += ' (practice)';
  }

  return partyName;
}
