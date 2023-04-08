import React, { useState } from 'react';
import { useRouter } from 'next/router';

export default function Home() {
  const [handleText, setHandleText] = useState<string>('');
  const [contestId, setContestId] = useState<number>();
  const [users, setUsers] = useState<string[]>([]);
  const [contestType, setContestType] = useState<string>('');

  const Router = useRouter();

  const handleStart = () => {
    if (contestId && users && users.length > 0 && contestType) {
      Router.push({
        pathname: `/contests/${contestId}/standings`,
        query: {
          contestType,
          handles: users,
        },
      });
    }
  };

  const addHandles = () => {
    let handles = handleText.split(',');
    handles = handles.filter((handle) => !users.includes(handle));

    if (handles.length > 0) {
      handles = handles.map((handle) => handle.trim());
      setUsers((oldUsers) => [...oldUsers, ...handles]);
    }
    setHandleText('');
  };

  return (
    <div className="flex flex-row bg-black h-screen items-center justify-center text-white">
      <div className="flex w-1/2 h-1/2 items-center justify-center">
        <div className="flex w-2/3 flex-col bg-slate-600 h-full p-3 justify-center border-8 border-zinc-800 rounded">

          <label className="mt-2" htmlFor="handles">
            Add comma separated user handles:
          </label>
          <p className="mb-2">(Teams are recognized by one of its members)</p>
          <div className="flex flex-row my-1" id="handles">
            <input
              className="w-1/2 p-1 bg-zinc-800 rounded"
              type="text"
              name="handles"
              value={handleText}
              onChange={(e) => setHandleText(e.target.value)}
              placeholder="handle1,handle2,..."
            />
            <div className="w-1/2 flex justify-center">
              <button
                className="w-2/3 bg-gray-400 hover:bg-gray-500 py-1 px-2 rounded"
                onClick={addHandles}
                type="button"
              >
                Add
              </button>
            </div>
          </div>

          <div className="flex flex-col my-1 overflow-y-auto w-1/2 h-2/3 p-1 bg-zinc-800 rounded">
            {users.map((user) => (
              <div key={user} className="flow-root justify-center py-1">
                <p className="float-left">{user}</p>
                <button
                  className="float-right  bg-gray-400 hover:bg-gray-500 py-1 px-1 rounded"
                  onClick={() => setUsers(users.filter((userOld) => userOld !== user))}
                  type="button"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

        </div>
      </div>

      <div className="flex w-1/2 h-1/2 items-center justify-center">
        <div className="flex flex-col w-2/3 bg-slate-600 h-full p-3 justify-center border-8 border-zinc-800 rounded">

          <div className="flex flex-col h-1/3 justify-center">
            <label className="mt-2" htmlFor="contest">
              Contest Id:
            </label>
            <p className="mb-2">
              (E.g. https://codeforces.com/contest/
              <b>1797</b>
              )
            </p>
            <div className="flex flex-row">
              <input
                className="w-1/2 p-1 bg-zinc-800 rounded"
                type="text"
                id="contest"
                name="contest"
                onChange={(e) => setContestId(parseInt(e.target.value, 10))}
              />
            </div>
          </div>

          <div className="flex flex-col h-1/3 justify-center">
            <div className="my-2">Contest Type:</div>

            <div className="flex flex-row">
              <label className="w-2/5 text-sm" htmlFor="normal">Normal Round</label>
              <div className="w-3/5">
                <input className="bg-zinc-800" type="radio" id="normal" name="contestType" value="normal" onClick={() => setContestType('normal')} />
              </div>
            </div>

            <div className="flex flex-row text-sm">
              <label className="w-2/5" htmlFor="educational">Educational/ICPC</label>
              <div className="w-3/5">
                <input className="bg-zinc-800" type="radio" name="contestType" id="educational" value="educational" onClick={() => setContestType('educational')} />
              </div>
            </div>
          </div>
          <div className="flex flex-col h-1/3 justify-center">
            <button
              className="my-2 bg-gray-400 hover:bg-gray-500 py-2 px-4 rounded"
              onClick={handleStart}
              type="button"
            >
              Start
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
