
export default function Veredict({veredict} : {veredict: string}) {
  
  switch (veredict) {
    case 'FAILED':
      return <p className="text-red-500">FAILED</p>
    case 'OK':
      return <p className="text-green-500">OK</p>
    case 'PARTIAL':
      return <p className="text-yellow-500">PARTIAL</p>
    case 'COMPILATION_ERROR':
      return <p className="text-red-500">COMPILATION ERROR</p>
    case 'RUNTIME_ERROR':
      return <p className="text-red-500">RUNTIME ERROR</p>
    case 'WRONG_ANSWER':
      return <p className="text-red-500">WRONG ANSWER</p>
    case 'PRESENTATION_ERROR':
      return <p className="text-yellow-500">PRESENTATION ERROR</p>
    case 'TIME_LIMIT_EXCEEDED':
      return <p className="text-blue-500">TIME LIMIT EXCEEDED</p>
    case 'MEMORY_LIMIT_EXCEEDED':
      return <p className="text-blue-500">MEMORY LIMIT EXCEEDED</p>
    case 'IDLENESS_LIMIT_EXCEEDED':
      return <p className="text-red-500">IDLENESS LIMIT EXCEEDED</p>
    case 'SECURITY_VIOLATED':
      return <p className="text-red-500">SECURITY VIOLATED</p>
    case 'CRASHED':
      return <p className="text-red-500">CRASHED</p>
    case 'INPUT_PREPARATION_CRASHED':
      return <p className="text-red-500">INPUT PREPARATION CRASHED</p>
    case 'CHALLENGED':
      return <p className="text-red-500">CHALLENGED</p>
    case 'SKIPPED':
      return <p className="text-gray-500">SKIPPED</p>
    case 'TESTING':
      return <p className="text-gray-500">TESTING</p>
    case 'REJECTED':
      return <p className="text-red-500">REJECTED</p>
    default:
      return <p className="text-gray-500">UNKNOWN</p>
  }
}