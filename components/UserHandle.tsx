import React from 'react';
import getName from '../utils/getName';

export default function userHandle({ author, userRank }
: { author : Party, userRank : Map<string, string> }) {
  let rankColor = 'text-white';

  const colorPerRank = new Map<string, string>([
    ['grandmaster', 'text-red-500'],
    ['international grandmaster', 'text-red-500'],
    ['legendary grandmaster', 'text-red-500'],
    ['international master', 'text-master'],
    ['master', 'text-master'],
    ['candidate master', 'text-candidate-master'],
    ['expert', 'text-blue-500'],
    ['specialist', 'text-specialist'],
    ['pupil', 'text-pupil'],
    ['newbie', 'text-gray-400'],
  ]);

  if (userRank.has(getName(author))) {
    rankColor = colorPerRank.get(userRank.get(getName(author)) as string) as string;
  }

  return (
    <p className={`${rankColor}`}>
      {' '}
      {getName(author)}
      {' '}
    </p>
  );
}
