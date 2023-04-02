import { useState, useEffect } from 'react';
import SubmissionLive from '../../../components/SubmissionsLive';
import StandingsList from '../../../components/StandingsList';
import { useRouter } from 'next/router'
import useInterval from '../../../hooks/useInterval'
import getName from "../../../utils/getName";

export default function Standings() {

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [newSubmissionsCount, setNewSubmissionsCount] = useState<number>(0);
  const [localStandings, setLocalStandings] = useState<Map<string, number>>();
  const [globalStandings, setGlobalStandings] = useState<Standings>();
  const [delay, setDelay] = useState<number>(100);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  
  const Router = useRouter()
  const { contestId, handles, contestType } = Router.query
  const users : string[] = typeof handles === 'string' ? [handles] : handles? handles : []

  const fetchSubmissions = async () => {

    const problemsForUser = new Map<string, Set<string>>()
    const standingForUser = new Map<string, number>()

    try {

      for (const user of users) {
        problemsForUser.set(user, new Set<string>())
        standingForUser.set(user, users.length)
      }

      const standingsRes = await fetch(process.env.CF_API + `contest.standings?contestId=${contestId}&handles=${users.join(';')}`
      , {mode: 'cors'});
      
      if(!standingsRes.ok) {
        throw new Error('Failed to fetch standings data');
      }

      const standings = await standingsRes.json()
      
      var prevRank = -1, prevPosition = -1
      for(const [i, row] of standings.result.rows.entries()){

        var position = i+1;
        if(row.rank === prevRank) {
          position = prevPosition
        }
        
        standingForUser.set(getName(row.party), position)

        prevRank = row.rank
        prevPosition = position
      }

      const res = await fetch(process.env.CF_API + `contest.status?contestId=${contestId}`, {mode: 'cors'});     

      if (!res.ok) {
        throw new Error('Failed to fetch submissions data');
      }
      const data = await res.json()
      data.result.reverse()

      const oldSubmissions : Submission[] = submissions.slice(0).reverse();
      console.log("oldSubmissions", oldSubmissions.length)
      let oldId = 0, newSubmissionsCountUpdate = 0;
      for (const submission of data.result) {
        
        if(users.includes(getName(submission.author))) {
          while (oldId < oldSubmissions.length && oldSubmissions[oldId].id !== submission.id) {
            oldId++;
          }
          if (oldId === oldSubmissions.length) {
            newSubmissionsCountUpdate++;
            oldSubmissions.push(submission);
            console.log("added")
          }
          else
            oldSubmissions[oldId] = submission;
        }
      }
      
      for(const submission of oldSubmissions){
        
        if(users.includes(getName(submission.author))) {

          if(submission.verdict === 'OK'){
            problemsForUser.get(getName(submission.author))?.add(submission.problem.index)
          }
          submission.numberOfProblems = problemsForUser.get(getName(submission.author))?.size as number
          submission.author.rank = standingForUser.get(getName(submission.author)) as number
        }
      }
      setNewSubmissionsCount(() => newSubmissionsCountUpdate);
      
      setSubmissions(() => oldSubmissions.reverse().slice(0));

      setGlobalStandings(standings.result)
      setLocalStandings(standingForUser)

      console.log('done')
      
    } catch(error) {
      console.log('Error while processing Submissions.', error);
    }
    
  }

  useEffect(() => {
    let timer = setTimeout(() => {
      setDelay(1000)
    }, 1000)
    return () => clearTimeout(timer)
  }, [])

  useInterval(async () => {

    setIsPaused(true)
    console.log('fetching')
    
    if(contestId && handles && contestType) {
      await fetchSubmissions()
    }

    setIsPaused(false)

  }, isPaused ? null : delay);
 
  return (
    <div className='flex flex-row bg-black text-white'>
      <div className='flex flex-col-reverse overflow-y-hidden h-screen w-2/5 p-5'>
      {submissions.map((submission, index) => (
        <div key={submission.id} className='h-6'>
          <SubmissionLive submission={submission} isNew={index < newSubmissionsCount} userCount={globalStandings?.rows.length as number}/>
        </div>
      ))}
      </div>
      {(localStandings && globalStandings) ? (
      <div className='h-screen w-3/5 p-5'>
        <StandingsList localStandings={localStandings} globalStandings={globalStandings} contestType={(contestType as string)}/>
      </div>
      ) : (
        <div className='h-screen w-3/5 p-5'>
          <div className="flex items-center justify-center h-screen">
            <h1 className='text-4xl animate-pulse'>Loading...</h1>
          </div>
        </div>
      )} 
    </div>
  )
}