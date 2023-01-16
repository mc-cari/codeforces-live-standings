import ProblemStatusEdu from "./ProblemStatusEdu";
import ProblemStatusNormal from "./ProblemStatusNormal";
import Position from "./Position";

export default function StandingsList({localStandings, globalStandings, type} : {localStandings: Map<string, number>, globalStandings: Standings, type: string}) {
 
  // function for color background
  const getColor = (position : number) => {
    if(position === 1 || position / globalStandings.rows.length <= 0.1) {
      return 'bg-yellow-500'
    }
    else if(position / globalStandings.rows.length <= 0.25) {
      return 'bg-slate-500'
    }
    else if(position / globalStandings.rows.length <= 0.5) {
      return 'bg-yellow-800'
    }
    else {
      return ''
    }
  }

  const problemsSolved : Map<string, number> = new Map<string, number>()

  for (const row of globalStandings.rows) {
    let solved = 0
    for(const problem of row.problemResults) {
      if(problem.points > 0) solved++;
    }
    if(row.party.teamName) {
      problemsSolved.set(row.party.teamName, solved)
    }
    else {
      problemsSolved.set(row.party.members[0].handle, solved)
    }
  }


  return (
    <div className='flex flex-col h-full w-full'>

      <div className='flex flex-row h-20 w-full'>
        <div className='bg-red-500 w-1/3 text-lg px-1 flex items-center justify-center'>CURRENT STANDINGS</div>
        <div className='flex-1 text-xl flex items-center justify-center'>Σ</div>
        <div className='flex-1 text-xl flex items-center justify-center'>
          {type === 'normal' ? 'PTS' : 'PEN'}
        </div>

        {globalStandings.problems.map(problem => (
         <div className='flex-1 text-xl flex items-center justify-center' key={problem.index}>{problem.index}</div> 
        ))}
      </div>

      {globalStandings.rows.map(row => (
        <div className='flex flex-row h-20 w-full' key={row.party.teamName ? row.party.teamName : row.party.members[0].handle}>
          <div className='flex flex-row w-1/3'>
            <div className='w-1/5 text-lg'>
              <Position position={localStandings.get(row.party.teamName ? row.party.teamName : row.party.members[0].handle) as number} 
                userCount={localStandings.size}
              />
            </div>  
            <div className='w-4/5 text-lg flex items-center px-3'>
              {row.party.teamName ?
                row.party.teamName :
                row.party.members[0].handle
              }
            </div>  
          </div>
          <div className='flex-1 text-lg flex items-center justify-center'>
            {problemsSolved.get(row.party.teamName ? row.party.teamName : row.party.members[0].handle)}
          </div>
          <div className='flex-1 text-lg flex items-center justify-center'>{type === 'normal' ? row.points : row.penalty}</div>

          {row.problemResults.map((problem, index) => (
            <div className='flex-1 h-full'  key={index}>

              {type === 'normal' ? <ProblemStatusNormal problem={problem} /> : <ProblemStatusEdu problem={problem} />}
              
            </div>
          ))}
        </div>

      ))}

      <div className='flex flex-row h-full w-2/5'>
        <div></div>
      </div>
      <div className='flex flex-row h-full w-3/5'></div>
    </div>
  )
}