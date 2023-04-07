import VeredictLive from "./Veredict"
import Position from "./Position"
import getName from "../utils/getName"
import UserHandle from "./UserHandle"

export default function LiveSubmission({submission, isNew, userCount, userRank} 
  : {submission: Submission, isNew : boolean, userCount : number,
     userRank : Map<string, string>}) {

  return (
    <div className={`h-full flex flox-row 
    ${isNew || submission.verdict === 'TESTING' ? 'animate-pulse' : ''}`} >

      <div className='w-1/12 text-xl'>
        <Position position={submission.author.rank} 
          userCount={userCount}
        />
      </div>  
      
      <div className={`grow flex items-center text-lg p-2`}>
        <UserHandle author={submission.author} userRank={userRank} />
        
      </div>
      <div className='w-1/12 flex items-center justify-center text-x'>{submission.numberOfProblems}</div>
      <div className='w-1/12 flex items-center justify-center text-xl'>{submission.problem.index}</div>
      <div className='w-1/12 text-xl'>
        <VeredictLive veredict={submission.verdict} test={submission.passedTestCount}/>
      </div>

    </div>
  )
}