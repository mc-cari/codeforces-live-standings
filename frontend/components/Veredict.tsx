import React from 'react';

interface VeredictInfo {
  bgColor: string;
  text: string;
}

export default function Veredict({ veredict, test } : { veredict: string, test: number }) {
  const VeredictsInfo = new Map<string, VeredictInfo>([
    ['FAILED', { bgColor: 'bg-red-500', text: 'FA' }],
    ['OK', { bgColor: 'bg-green-500', text: 'AC' }],
    ['PARTIAL', { bgColor: 'bg-yellow-500', text: 'PRT' }],
    ['COMPILATION_ERROR', { bgColor: 'bg-red-500', text: 'CE' }],
    ['RUNTIME_ERROR', { bgColor: 'bg-red-500', text: 'RE' }],
    ['WRONG_ANSWER', { bgColor: 'bg-red-500', text: 'WA' }],
    ['PRESENTATION_ERROR', { bgColor: 'bg-yellow-500', text: 'PE' }],
    ['TIME_LIMIT_EXCEEDED', { bgColor: 'bg-blue-500', text: 'TLE' }],
    ['MEMORY_LIMIT_EXCEEDED', { bgColor: 'bg-blue-500', text: 'MLE' }],
    ['IDLENESS_LIMIT_EXCEEDED', { bgColor: 'bg-blue-500', text: 'ILE' }],
    ['SECURITY_VIOLATED', { bgColor: 'bg-red-500', text: 'SV' }],
    ['CRASHED', { bgColor: 'bg-red-500', text: 'CRSH' }],
    ['INPUT_PREPARATION_CRASHED', { bgColor: 'bg-red-500', text: 'IPC' }],
    ['CHALLENGED', { bgColor: 'bg-red-500', text: 'CH' }],
    ['SKIPPED', { bgColor: 'bg-gray-500', text: 'SKP' }],
    ['REJECTED', { bgColor: 'bg-red-500', text: 'RJC' }],
    ['UNDEFINED', { bgColor: 'bg-gray-500', text: 'UNW' }],
  ]);

  const getVeredictInfo = () : VeredictInfo => {
    if (VeredictsInfo.has(veredict)) {
      return VeredictsInfo.get(veredict) as VeredictInfo;
    }
    if (veredict === 'TESTING') {
      return { bgColor: 'bg-gray-500', text: `T${test.toString()}` };
    }
    return { bgColor: 'bg-gray-500', text: 'UNW' };
  };

  const veredictInfo = getVeredictInfo();

  return (
    <div className={`${veredictInfo.bgColor} w-full h-full flex items-center justify-center`}>
      {' '}
      {veredictInfo.text}
      {' '}
    </div>
  );
}
