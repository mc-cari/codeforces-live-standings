// The display identity is shared by standings and replay projections.
export type PartyNameSource = {
  participantType: string;
  teamName?: string;
  members: Array<{ handle: string }>;
};

export default function getName(party: PartyNameSource): string {
  let partyName = party.teamName ? party.teamName : party.members[0].handle;

  if (party.participantType === 'PRACTICE') {
    partyName += ' (practice)';
  }

  return partyName;
}
