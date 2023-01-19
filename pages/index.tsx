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
  const [contestId, setContestId] = useState<number>();
  const [contestInput, setContestInput] = useState<number>();
  const [users, setUsers] = useState<string[]>([]);
  const [localStandings, setLocalStandings] = useState<Map<string, number>>();
  const [globalStandings, setGlobalStandings] = useState<Standings>();
  const [contestType, setContestType] = useState<string>('');

  const fetchSubmissions = async (ind : number) => {

    const problemsForUser = new Map<string, Set<string>>()
    const standingForUser = new Map<string, number>()

    for (const user of users) {
      problemsForUser.set(user, new Set<string>())
      standingForUser.set(user, users.length)
    }

    try {
      console.log(process.env.CF_API + `contest.standings?contestId=${contestId}&handles=${users.join(';')}`)
      const standingsRes = await fetch(process.env.CF_API + `contest.standings?contestId=${contestId}&handles=${users.join(';')}`);
      

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

      const res = await fetch(process.env.CF_API + `contest.status?contestId=${contestId}`);   

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
    if(contestId && users && users.length > 0 && contestType) {
      setConfig(false)
      fetchSubmissions(0);
    }
  }

  const addHandles = () => {
    var handles = handleText.split(',')
    handles = handles.filter(handle => !users.includes(handle))

    if(handles.length > 0){

      handles = handles.map(handle => handle.trim())
      setUsers(users => [...users, ...handles])
      console.log([...users, ...handles])
    }
    setHandleText('')

  }

  const handleContestId = () => {
    if(contestInput) {
      setContestId(contestInput)
      setContestInput(undefined)
    }
  }

  useEffect(() => {

    console.log('updated')
    
  }, [newSubmissions])

  useEffect(() => {
    console.log(subIndex)
  }, [subIndex])

  if(config)
    return (
      <div className='flex flex-row bg-black h-screen items-center justify-center text-white'>
        <div className='flex w-1/2 h-1/2 items-center justify-center'>
          <div className='flex w-2/3 flex-col bg-slate-600 h-full p-3 justify-center border-8 border-zinc-800 rounded'>
            
            <label className='my-2' htmlFor='handles'>Add comma separated handles:</label>
            <div className='flex flex-row my-1'>
              <input className='w-1/2 p-1 bg-zinc-800 rounded' type='text' id='handles' name='handles' value={handleText}
                onChange={(e) => setHandleText(e.target.value)} placeholder='handle1,handle2,...'
              ></input>
              <div className='w-1/2 flex justify-center'>
                <button className='w-2/3 bg-gray-400 hover:bg-gray-500 py-1 px-2 rounded'
                onClick={addHandles} >Add</button>
              </div>
            </div>

            <div className='flex flex-col my-1 overflow-y-auto w-1/2 h-2/3 p-1 bg-zinc-800 rounded'>
              {users.map((user, index) => (
                <div key={index} className='flow-root justify-center py-1'>
                  <p className='float-left'>{user}</p>
                  <button className='float-right  bg-gray-400 hover:bg-gray-500 py-1 px-1 rounded'
                    onClick={() => setUsers(users.filter(userOld => userOld !== user))}>Remove</button>
                </div>
              ))} 
            </div>
           
          </div>
        </div>

        <div className='flex w-1/2 h-1/2 items-center justify-center'>
          <div className='flex flex-col w-2/3 bg-slate-600 h-full p-3 justify-center border-8 border-zinc-800 rounded'>
            
            <div className='flex flex-col h-1/3 justify-center'>
              <label className='my-2' htmlFor='contest'>ContestId:</label>
              <div className='flex flex-row'>
                <input className='w-1/2 p-1 bg-zinc-800 rounded' type='text' id='contest' name='contest'
                  onChange={(e) => setContestId(parseInt(e.target.value))}
                ></input>
              </div>
            </div>
            
            <div className='flex flex-col h-1/3 justify-center'>
              <label className='my-2' htmlFor='contestType'>Contest Type:</label>

              <div className='flex flex-row'>
                <label className='w-2/5 text-sm' htmlFor="normal">Normal Round</label>
                <div className='w-3/5'>
                  <input className='bg-zinc-800' type="radio" id="normal" name="contestType" value="normal" onClick={() => setContestType('normal')}></input>
                </div>
              </div>
            
              <div className='flex flex-row text-sm'>
                <label className='w-2/5' htmlFor="educational">Educational/ICPC</label>
                <div className='w-3/5'>
                  <input className='bg-zinc-800' type="radio" id="educational" name="contestType" value="educational" onClick={() => setContestType('educational')}></input>
                </div>
              </div>
            </div>
            <div className='flex flex-col h-1/3 justify-center'>
              <button className='my-2 bg-gray-400 hover:bg-gray-500 py-2 px-4 rounded' 
                onClick={handleStart}>Start</button>
            </div>
            
          </div>
        </div>
      </div>
    ) 

  return (

    <div className='flex flex-row bg-black text-white'>
      <div className='flex flex-col-reverse overflow-y-hidden h-screen w-2/5 p-5'>
      {newSubmissions.map((submission, index) => (
        <div key={submission.id} className='h-12'>
          <SubmissionLive submission={submission} isNew={index < subIndex} userCount={users.length}/>
        </div>
      ))}
      </div>
      {localStandings && globalStandings && (
      <div className='h-screen w-3/5 p-5'>
        <StandingsList localStandings={localStandings} globalStandings={globalStandings} contestType={contestType}/>
      </div>
      )} 
    </div>

  )
}