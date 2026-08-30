const CODEFORCES_API_URL = 'https://codeforces.com/api/';
const FRIENDS_REQUEST_TIMEOUT_MILLISECONDS = 30_000;

const toHex = (bytes: Uint8Array) => Array.from(bytes)
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

export const createBrowserSignature = async (
  method: string,
  parameters: URLSearchParams,
  apiSecret: string,
) => {
  const randomPrefix = toHex(globalThis.crypto.getRandomValues(new Uint8Array(3)));
  parameters.set('time', Math.floor(Date.now() / 1000).toString());
  parameters.sort();

  const signatureSource = `${randomPrefix}/${method}?${parameters.toString()}#${apiSecret}`;
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-512',
    new TextEncoder().encode(signatureSource),
  );

  return `${randomPrefix}${toHex(new Uint8Array(digest))}`;
};

export const fetchCodeforcesFriends = async (
  apiKey: string,
  apiSecret: string,
) => {
  const method = 'user.friends';
  const parameters = new URLSearchParams({ apiKey });
  const apiSignature = await createBrowserSignature(method, parameters, apiSecret);
  parameters.set('apiSig', apiSignature);

  return fetch(`${CODEFORCES_API_URL}${method}?${parameters.toString()}`, {
    signal: AbortSignal.timeout(FRIENDS_REQUEST_TIMEOUT_MILLISECONDS),
  });
};
