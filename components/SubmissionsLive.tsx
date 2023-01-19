import VeredictLive from "./VeredictLive"
import Position from "./Position"

export default function Submission({submission, isNew, userCount} 
  : {submission: Submission, isNew : boolean, userCount : number}) {

  return (
    <div className={`h-full flex flox-row m-2
    ${isNew || submission.verdict === 'TESTING' ? 'animate-pulse' : ''}`} >

      <div className='w-1/12 text-xl'>
        <Position position={submission.author.rank} 
          userCount={userCount}
        />
      </div>  
      
      <div className='grow flex items-center text-lg p-2'>
        {submission.author.teamName ? 
          submission.author.teamName :
          submission.author.members[0].handle
        }  
      </div>
      <div className='w-1/12 flex items-center justify-center text-xl'>{submission.numberOfProblems}</div>
      <div className='w-1/12 flex items-center justify-center text-xl'>{submission.problem.index}</div>
      <div className='w-1/12 text-xl'>
        <VeredictLive veredict={submission.verdict} test={submission.passedTestCount}/>
      </div>

    </div>
  )
}