import ProblemStatusEdu from "./ProblemStatusEdu";
import ProblemStatusNormal from "./ProblemStatusNormal";
import Position from "./Position";
import getName from "../utils/getName";

export default function StandingsList({localStandings, globalStandings, contestType} :
   {localStandings: Map<string, number>, globalStandings: Standings, contestType: string}) {

  const problemsSolved : Map<string, number> = new Map<string, number>()

  for (const row of globalStandings.rows) {
    let solved = 0
    for(const problem of row.problemResults) {
      if(problem.points > 0) solved++;
    }
    problemsSolved.set(getName(row.party), solved)
  }

  return (
    <div className='flex flex-col h-full w-full'>

      <div className='flex flex-row h-14 w-full'>
        <div className='bg-red-500 w-1/3 text-lg px-1 flex items-center justify-center'>CURRENT STANDINGS</div>
        <div className='flex-1 text-xl flex items-center justify-center'>Σ</div>
        <div className='flex-1 text-xl flex items-center justify-center'>
          {contestType === 'normal' ? 'PTS' : 'PEN'}
        </div>

        {globalStandings.problems.map(problem => (
         <div className='flex-1 text-xl flex items-center justify-center' key={problem.index}>{problem.index}</div> 
        ))}
      </div>
        
      <div className='flex flex-col grow w-full overflow-y-auto scrollbar-hide'>
        {globalStandings.rows.map(row => (
          <div className='flex flex-row h-12 w-full' key={getName(row.party)}>
            <div className='flex flex-row w-1/3'>
              <div className='w-1/5 text-xl'>
                <Position position={localStandings.get(getName(row.party)) as number} 
                  userCount={globalStandings.rows.length}
                />
              </div>  
              <div className='w-4/5 text-lg flex items-center px-3'>
                {getName(row.party)}
              </div>  
            </div>
            <div className='flex-1 text-xl flex items-center justify-center'>
              {problemsSolved.get(getName(row.party))}
            </div>
            <div className='flex-1 text-lg flex items-center justify-center'>{contestType === 'normal' ? row.points : row.penalty}</div>

            {row.problemResults.map((problem, index) => (
              <div className='flex-1 h-full'  key={index}>

                {contestType === 'normal' ? <ProblemStatusNormal problem={problem} /> : <ProblemStatusEdu problem={problem} />}
                
              </div>
            ))}
          </div>

        ))}
      </div>

    </div>
  )
}