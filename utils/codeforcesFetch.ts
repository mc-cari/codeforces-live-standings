export default function codeforcesFetch(
  method: string,
  parameters: Record<string, string | number | boolean>,
  init?: RequestInit,
) {
  const searchParameters = new URLSearchParams({ method });
  Object.entries(parameters).forEach(([key, value]) => {
    searchParameters.set(key, String(value));
  });

  return fetch(`/api/codeforces?${searchParameters.toString()}`, init);
}

export function codeforcesPost(
  method: string,
  parameters: Record<string, string | number | boolean>,
) {
  return fetch('/api/codeforces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, ...parameters }),
  });
}
