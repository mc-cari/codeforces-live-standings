// The display identity is shared by standings and replay projections.

type NamedParty = {
  teamName?: string;
  members: Array<{ handle: string }>;
  participantType: string;
};

export default function getName(party: NamedParty): string {
  let partyName = party.teamName ? party.teamName : party.members[0].handle;

  if (party.participantType === 'PRACTICE') {
    partyName += ' (practice)';
  }

  return partyName;
}
