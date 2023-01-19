import { useState, useEffect} from 'react';
import SubmissionLive from '../../../components/SubmissionsLive';
import StandingsList from '../../../components/StandingsList';
import { useRouter } from 'next/router'

const sleep = (ms : number) => new Promise(
  resolve => setTimeout(resolve, ms)
);

export default function Standings() {

  const [newSubmissions, setNewSubmissions] = useState<Submission[]>([]);
  const [subIndex, setSubIndex] = useState<number>(0);
  const [localStandings, setLocalStandings] = useState<Map<string, number>>();
  const [globalStandings, setGlobalStandings] = useState<Standings>();

  const Router = useRouter()
  const { contestId, handles, contestType } = Router.query

  useEffect(() => {

    const fetchSubmissions = async (ind: number, users: string[]) => {

      const problemsForUser = new Map<string, Set<string>>()
      const standingForUser = new Map<string, number>()
  
      for (const user of users) {
        problemsForUser.set(user, new Set<string>())
        standingForUser.set(user, users.length)
      }
  
      try {
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
  
        await sleep(500);       
        fetchSubmissions(aux.length, users)
        
      } catch(error) {
        console.log('Error while doing get Submissions.', error);
      }
    }

    if(contestId && handles && contestType) {

      if(typeof handles === 'string') fetchSubmissions(0, [handles])
      else fetchSubmissions(0, handles)
      
    }
  }, [contestId, handles, contestType])
  
  useEffect(() => {

    console.log('updated')
    
  }, [newSubmissions])
 
  return (

    <div className='flex flex-row bg-black text-white'>
      <div className='flex flex-col-reverse overflow-y-hidden h-screen w-2/5 p-5'>
      {newSubmissions.map((submission, index) => (
        <div key={submission.id} className='h-12'>
          <SubmissionLive submission={submission} isNew={index < subIndex} userCount={handles?.length as number}/>
        </div>
      ))}
      </div>
      {localStandings && globalStandings && (
      <div className='h-screen w-3/5 p-5'>
        <StandingsList localStandings={localStandings} globalStandings={globalStandings} contestType={(contestType as string)}/>
      </div>
      )} 
    </div>

  )
}