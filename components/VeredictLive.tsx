
export default function Veredict({veredict, test} : {veredict: string, test: number}) {
  
  var bgColor = '';
  var text = '';

  switch (veredict) {
    case 'FAILED':
      bgColor = 'bg-red-500';
      text = 'FA';
      break;
    case 'OK':
      bgColor = 'bg-green-500';
      text = 'AC';
      break;
    case 'PARTIAL':
      bgColor = 'bg-yellow-500';
      text = 'PT';
      break;
    case 'COMPILATION_ERROR':
      bgColor = 'bg-red-500';
      text = 'CE';
      break;
    case 'RUNTIME_ERROR':
      bgColor = 'bg-red-500';
      text = 'RE';
      break;
    case 'WRONG_ANSWER':
      bgColor = 'bg-red-500';
      text = 'WA';
      break;
    case 'PRESENTATION_ERROR':
      bgColor = 'bg-yellow-500';
      text = 'PE'
    case 'TIME_LIMIT_EXCEEDED':
      bgColor = 'bg-blue-500';
      text = 'TLE';
      break;
    case 'MEMORY_LIMIT_EXCEEDED':
      bgColor = 'bg-blue-500';
      text = 'MLE';
      break;
    case 'IDLENESS_LIMIT_EXCEEDED':
      bgColor = 'bg-blue-500';
      text = 'ILE';
      break;
    case 'SECURITY_VIOLATED':
      bgColor = 'bg-red-500';
      text = 'SV';
      break;
    case 'CRASHED':
      bgColor = 'bg-red-500';
      text = 'CRSH';
      break;
    case 'INPUT_PREPARATION_CRASHED':
      bgColor = 'bg-red-500';
      text = 'IPC'
    case 'CHALLENGED':
      bgColor = 'bg-red-500';
      text = 'CH';
      break;
    case 'SKIPPED':
      bgColor = 'bg-gray-500';
      text = 'SKP'
    case 'TESTING':
      bgColor = 'bg-gray-500';
      text = 'T' + test.toString();
      break;
    case 'REJECTED':
      bgColor = 'bg-red-500';
      text = 'RJC';
      break;
    default:
      bgColor = 'bg-gray-500';
      text = 'UNW'
  }

  return <div className={`${bgColor} w-full h-full flex items-center justify-center`}> {text} </div>

}