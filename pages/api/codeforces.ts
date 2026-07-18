import type { NextApiRequest, NextApiResponse } from 'next';
import { createHash, randomBytes } from 'crypto';

const CODEFORCES_API_URL = process.env.CF_API_BASE_URL || 'https://codeforces.com/api/';

const allowedParameters: Record<string, Set<string>> = {
  'contest.standings': new Set(['contestId', 'handles', 'from', 'count', 'showUnofficial']),
  'contest.status': new Set(['contestId', 'handles']),
  'user.info': new Set(['handles']),
};

type CachedResponse = {
  body: string;
  status: number;
  expiresAt: number;
};

const responseCache = new Map<string, CachedResponse>();

const cacheDuration = (method: string): number => {
  if (method === 'user.info') return 60 * 60 * 1000;
  if (method === 'contest.standings') return 10 * 1000;
  return 2 * 1000;
};

const getSingleQueryValue = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) return undefined;
  return value;
};

const toCodeforcesQuery = (parameters: URLSearchParams): string => (
  parameters.toString().replace(/%3B/gi, ';')
);

const createSignature = (method: string, parameters: URLSearchParams): string => {
  const apiKey = process.env.CF_API_KEY;
  const apiSecret = process.env.CF_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('Codeforces API credentials are not configured');
  }

  parameters.set('apiKey', apiKey);
  parameters.set('time', Math.floor(Date.now() / 1000).toString());
  parameters.sort();

  const randomPrefix = randomBytes(3).toString('hex');
  const signatureSource = `${randomPrefix}/${method}?${toCodeforcesQuery(parameters)}#${apiSecret}`;
  const digest = createHash('sha512').update(signatureSource).digest('hex');

  return `${randomPrefix}${digest}`;
};

const filterSubmissions = (body: string, handles: string | null): string => {
  if (!handles) return body;

  const selectedHandles = new Set(handles.split(';'));
  const response = JSON.parse(body) as { result?: Submission[] };
  if (!Array.isArray(response.result)) return body;

  return JSON.stringify({
    ...response,
    result: response.result.filter((submission) => (
      submission.author.members.some((member) => selectedHandles.has(member.handle))
    )),
  });
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ status: 'FAILED', comment: 'Method not allowed' });
    return;
  }

  const method = getSingleQueryValue(req.query.method);
  if (!method || !allowedParameters[method]) {
    res.status(400).json({ status: 'FAILED', comment: 'Unsupported Codeforces API method' });
    return;
  }

  const parameters = new URLSearchParams();
  allowedParameters[method].forEach((parameter) => {
    const value = getSingleQueryValue(req.query[parameter]);
    if (value) parameters.set(parameter, value);
  });

  if (!parameters.get('contestId') && method.startsWith('contest.')) {
    res.status(400).json({ status: 'FAILED', comment: 'contestId is required' });
    return;
  }
  if ((method === 'user.info' || method === 'contest.status') && !parameters.get('handles')) {
    res.status(400).json({ status: 'FAILED', comment: 'handles is required' });
    return;
  }

  try {
    const handles = method === 'contest.status' ? parameters.get('handles') : null;
    const query = toCodeforcesQuery(parameters);
    const cacheKey = `${method}?${query}`;
    const cachedResponse = responseCache.get(cacheKey);
    let body: string;
    let status: number;

    if (cachedResponse && cachedResponse.expiresAt > Date.now()) {
      ({ body, status } = cachedResponse);
    } else {
      let signedQuery = query;
      if (method !== 'contest.standings') {
        const apiSignature = createSignature(method, parameters);
        signedQuery = `${toCodeforcesQuery(parameters)}&apiSig=${apiSignature}`;
      }

      const response = await fetch(`${CODEFORCES_API_URL}${method}?${signedQuery}`);
      body = await response.text();
      status = response.status;
      responseCache.set(cacheKey, {
        body,
        status,
        expiresAt: Date.now() + cacheDuration(method),
      });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(status).send(method === 'contest.status' ? filterSubmissions(body, handles) : body);
  } catch (error) {
    const comment = error instanceof Error ? error.message : 'Unable to contact Codeforces';
    res.status(502).json({ status: 'FAILED', comment });
  }
}
