export default function codeforcesFetch(method: string, parameters: Record<string, string | number | boolean>) {
  const searchParameters = new URLSearchParams({ method });
  Object.entries(parameters).forEach(([key, value]) => {
    searchParameters.set(key, String(value));
  });

  return fetch(`/api/codeforces?${searchParameters.toString()}`);
}
