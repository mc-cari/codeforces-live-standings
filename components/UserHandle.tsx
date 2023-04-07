import getName from "../utils/getName"


export default function userHandle({author, userRank} : {author : Party, userRank : Map<string, string>}) {

  let rankColor = 'text-white'

  if (userRank.has(getName(author))) {
    switch (userRank.get(getName(author))) {
      case 'grandmaster':
      case 'international grandmaster':
      case 'legendary grandmaster':
        rankColor = 'text-red-500'
        break
      case 'international master':
      case 'master':
        rankColor = 'text-master'
        break
      case 'candidate master':
        rankColor = 'text-candidate-master'
        break
      case 'expert':
        rankColor = 'text-blue-500'
        break
      case 'specialist':
        rankColor = 'text-specialist'
        break
      case 'pupil':
        rankColor = 'text-pupil'
        break
      case 'newbie':
        rankColor = 'text-gray-400'
        break
    }
  }

  return (
    <p className={`${rankColor}`}> {getName(author) + ((author.participantType == 'PRACTICE') ? ' (practice)' : '') } </p>
  )
}