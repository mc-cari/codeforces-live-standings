type CacheableResponse = {
  body: string;
  status: number;
};

export const FAILURE_CACHE_DURATION_MILLISECONDS = 2_000;

export const isSuccessfulCodeforcesResponse = (response: CacheableResponse): boolean => {
  if (response.status !== 200) return false;

  try {
    const payload = JSON.parse(response.body) as {
      status?: unknown;
      result?: unknown;
    };
    return payload.status === 'OK' && payload.result !== undefined;
  } catch {
    return false;
  }
};

export const getResponseCacheDuration = (
  successDurationMilliseconds: number,
  response: CacheableResponse,
): number => (
  isSuccessfulCodeforcesResponse(response)
    ? successDurationMilliseconds
    : Math.min(successDurationMilliseconds, FAILURE_CACHE_DURATION_MILLISECONDS)
);
