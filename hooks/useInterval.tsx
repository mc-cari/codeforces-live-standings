import { useEffect, useRef } from "react";

//https://stackoverflow.com/a/59274004
export default function useInterval(callback : () => void, delay : number | null) {
  const callbackRef = useRef<() => void>();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {

    if (typeof delay === "number") {
      intervalRef.current = setInterval(() => callbackRef.current?.(), delay);
      return () => clearInterval(intervalRef.current ? intervalRef.current : 0);
    }
  }, [delay]);

  return intervalRef;
}