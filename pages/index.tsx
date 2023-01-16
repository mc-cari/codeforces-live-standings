import { useState, useEffect, Fragment, use} from 'react';
import SubmissionLive from '../components/SubmissionsLive';
import StandingsList from '../components/StandingsList';

const sleep = (ms : number) => new Promise(
  resolve => setTimeout(resolve, ms)
);

export default function Home() {

  const [newSubmissions, setNewSubmissions] = useState<Submission[]>([]);
  const [subIndex, setSubIndex] = useState<number>(0);
  const [config, setConfig] = useState<boolean>(true);
  const [handleText, setHandleText] = useState<string>('');
  const [contest, setContest] = useState<number>(0);
  const [users, setUsers] = useState<string[]>([]);
  const [localStandings, setLocalStandings] = useState<Map<string, number>>();
  const [globalStandings, setGlobalStandings] = useState<Standings>();

  const fetchSubmissions = async (ind : number) => {

    const problemsForUser = new Map<string, Set<string>>()
    const standingForUser = new Map<string, number>()

    for (const user of users) {
      problemsForUser.set(user, new Set<string>())
      standingForUser.set(user, users.length)
    }

    try {
      console.log(process.env.CF_API + `contest.standings?contestId=${contest}&handles=${users.join(';')}`)
      const standingsRes = await fetch(process.env.CF_API + `contest.standings?contestId=${contest}&handles=${users.join(';')}`);
      

      if(!standingsRes.ok) {
        throw new Error('Failed to fetch standings data');
      }

      const standings = await standingsRes.json()
      setGlobalStandings(standings.result)
      var prevRank = -1, prevPosition = -1
      for(const [i, row] of standings.result.rows.entries()){

        var position = i+1;
        if(row.rank === prevRank) {
          position = prevPosition
        }
        if(row.party.teamName) {
          standingForUser.set(row.party.teamName, position)
        }
        else {
          standingForUser.set(row.party.members[0].handle, position)
        }

        prevRank = row.rank
        prevPosition = position
      }

      console.log(standingForUser)
      setLocalStandings(standingForUser)

      const res = await fetch(process.env.CF_API + `contest.status?contestId=${contest}`);   

      if (!res.ok) {
        throw new Error('Failed to fetch submissions data');
      }
      const data = await res.json()

      const aux = []
      for(const submission of data.result.reverse()){
        if(users.includes(submission.author.teamName)
        || users.includes(submission.author.members[0].handle)) {

          if(submission.verdict === 'OK'){
            if(submission.author.teamName) problemsForUser.get(submission.author.teamName)?.add(submission.problem.index)
            else problemsForUser.get(submission.author.members[0].handle)?.add(submission.problem.index)

          }

          if(submission.author.teamName){
            submission.numberOfProblems = problemsForUser.get(submission.author.teamName)?.size
            submission.author.rank = standingForUser.get(submission.author.teamName) as number
          }
          else{
            submission.numberOfProblems = problemsForUser.get(submission.author.members[0].handle)?.size
            submission.author.rank = standingForUser.get(submission.author.members[0].handle) as number
          }
          aux.push(submission)
        }
      }
      setNewSubmissions(aux.reverse().slice(0, 15));
      setSubIndex(aux.length - ind);

      await sleep(1700);       
      fetchSubmissions(aux.length)
      
    } catch(error) {
      console.log('Error while doing get Submissions.', error);
    }
  }
  

  const handleStart = () => {
    setConfig(false)
    fetchSubmissions(0);
  }

  const addHandles = () => {
    var handles = handleText.split(',')
    handles = handles.filter(handle => !users.includes(handle))

    if(handles.length > 0){
      setUsers(users => [...users, ...handles])
      console.log([...users, ...handles])
    }
    setHandleText('')

  }

  useEffect(() => {

    console.log('updated')
    
  }, [newSubmissions])

  useEffect(() => {
    console.log(subIndex)
  }, [subIndex])

  if(config)
    return (
      <div className='flex flex-row h-screen items-center justify-center'>
        <div className='flex w-1/2 h-1/2 items-center justify-center'>
          <div className='flex w-1/2 flex-col bg-slate-400 h-full p-5  items-center justify-center border-8 border-gray-200'>
            <label htmlFor='handles'>Add comma separated handles:</label>
            <div className='flex flex-row'>
              <input type='text' id='handles' name='handles' value={handleText}
                onChange={(e) => setHandleText(e.target.value)}
              ></input>
              <button onClick={addHandles} >Add handles</button>
            </div>

            <label htmlFor='contest'>ContestId:</label>
            <input type='text' id='contest' name='contest'
              onChange={(e) => setContest(parseInt(e.target.value))}
            ></input>
            
            <button onClick={handleStart}>Start</button>
          </div>
        </div>

        <div className='flex w-1/2 h-1/2 items-center justify-center'>
          <div className='flex flex-row w-1/2 bg-slate-400 h-full p-5 items-center justify-center border-8 border-gray-200'>
            <div className='flex flex-col items-center justify-center w-1/2'>
              <h2>Users:</h2>
              <div className='flex flex-col items-center overflow-y-auto h-48 bg-gray-200'>
                {users.map((user, index) => (
                  <div key={index} className='flex flex-row'>
                    <p>{user}</p>
                    <button className='bg-gray-500' onClick={() => setUsers(users.filter(userOld => userOld !== user))}>Remove</button>
                  </div>
                ))} 
              </div>
            </div>
            <div className='flex flex-col items-center justify-center w-1/2'>
              <p>Contest: {contest}</p>
            </div>
          </div>
        </div>
      </div>
    ) 

  return (

    <div className='flex flex-row'>
      <div className='flex flex-col-reverse overflow-y-hidden h-screen w-2/5 p-5'>
      {newSubmissions.map((submission, index) => (
        <div key={submission.id} className='h-12'>
          <SubmissionLive submission={submission} isNew={index < subIndex} userCount={users.length}/>
        </div>
      ))}
      </div>
      {localStandings && globalStandings && (
      <div className='h-screen w-3/5 p-5'>
        <StandingsList localStandings={localStandings} globalStandings={globalStandings} type={'educational'}/>
      </div>
      )} 
    </div>

  )
}