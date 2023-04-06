import VeredictLive from "./Veredict"
import Position from "./Position"
import getName from "../utils/getName"

export default function LiveSubmission({submission, isNew, userCount} 
  : {submission: Submission, isNew : boolean, userCount : number}) {

    let rankColor = ''

    if(false)
      rankColor = 'text-master'
    

  return (
    <div className={`h-full flex flox-row 
    ${isNew || submission.verdict === 'TESTING' ? 'animate-pulse' : ''}`} >

      <div className='w-1/12 text-xl'>
        <Position position={submission.author.rank} 
          userCount={userCount}
        />
      </div>  
      
      <div className={`grow flex items-center text-lg p-2 first-letter:red ${rankColor}`}>
        {getName(submission.author)}  
      </div>
      <div className='w-1/12 flex items-center justify-center text-xl'>{submission.numberOfProblems}</div>
      <div className='w-1/12 flex items-center justify-center text-xl'>{submission.problem.index}</div>
      <div className='w-1/12 text-xl'>
        <VeredictLive veredict={submission.verdict} test={submission.passedTestCount}/>
      </div>

    </div>
  )
}