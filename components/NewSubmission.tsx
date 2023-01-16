import Veredict from "./Veredict"

export default function NewSubmission({submission} : {submission: Submission}) {
  return (
    <div className="flex flox-row m-2 border-solid border-2 border-sky-500 animate-bounce">
      <p>Id: {submission.id}</p>
      <p>Index: {submission.problem.index}</p>
      <p>Author: {submission.author.members[0].handle}</p>
      <Veredict veredict={submission.verdict}/>
      <p>Test Count: {submission.passedTestCount}</p>
      <p>Time: {submission.timeConsumedMillis}</p>
      <p>TimeSubmit: {submission.creationTimeSeconds}</p>
    </div>
  )
}