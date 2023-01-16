export default function ProblemStatusEdu({problem} : {problem : ProblemResult}) {
  return (
    <>
      {(problem.points > 0 || problem.rejectedAttemptCount > 0) && 
        <div className={`flex flex-col items-center text-lg justify-center py-1 h-full bg-${problem.points > 0 ? 'green-500' : 'red-500'}`}>

          {problem.points > 0 
            ? '+' + (problem.rejectedAttemptCount > 0 ? problem.rejectedAttemptCount : '')
            : '- ' +  problem.rejectedAttemptCount.toString()}
        </div>
      }
    </>
  )
}