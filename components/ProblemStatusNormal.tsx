export default function ProblemStatusNormal({problem} : {problem : ProblemResult}) {
  return (
    <>
      {(problem.points > 0 || problem.rejectedAttemptCount > 0) && 
        <div className={`flex flex-col items-center justify-center py-1 h-full bg-${problem.points > 0 ? 'green-500' : 'red-500'}`}>
          <div className='h-2/3 flex items-center justify-center'>
            {problem.points > 0 ? problem.points : '0'}
          </div>
          <div className='h-1/3 text-xs flex items-center justify-center'>
            {problem.rejectedAttemptCount + Number(problem.points > 0) == 1 ? '1 try': 
              problem.rejectedAttemptCount + Number(problem.points > 0) + ' tries'}
          </div>
        </div>
      }
    </>
  )
}