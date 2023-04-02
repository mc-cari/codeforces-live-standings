export default function getName(party : Party) {
  if(party.teamName) {
    return party.teamName
  }
  else {
    return party.members[0].handle
  }
}