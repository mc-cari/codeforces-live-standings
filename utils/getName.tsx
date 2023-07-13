export default function getName(party : Party) : string {
  let partyName = party.teamName ? party.teamName : party.members[0].handle;

  if (party.participantType === 'PRACTICE') {
    partyName += ' (practice)';
  }

  return partyName;
}
