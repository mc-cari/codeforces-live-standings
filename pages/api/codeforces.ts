import type { NextApiRequest, NextApiResponse } from 'next';
import { createHash, randomBytes } from 'crypto';
import { Agent, fetch as undiciFetch } from 'undici';
import ExpiringCache from '../../utils/expiringCache';
import getName from '../../utils/getName';
import { selectParticipantHandles } from '../../utils/participantImport';
import type { ParticipantSelection } from '../../utils/participantImport';
import RequestCoordinator from '../../utils/requestCoordinator';

const CODEFORCES_API_URL = process.env.CF_API_BASE_URL || 'https://codeforces.com/api/';

const allowedParameters: Record<string, Set<string>> = {
  'contest.list': new Set(['gym']),
  'contest.info': new Set(['contestId']),
  'contest.standings': new Set(['contestId']),
  'contest.status': new Set(['contestId', 'handles', 'participantTypes']),
  'participant.import': new Set(['contestId', 'count', 'selection']),
  'user.info': new Set(['handles']),
};

const anonymousMethods = new Set(['contest.list', 'contest.standings']);
const freshConnectionMethods = new Set(['contest.standings', 'contest.status']);

type CachedResponse = {
  body: string;
  status: number;
};

const responseCache = new ExpiringCache<CachedResponse>(Date.now, {
  maximumWeight: 100 * 1024 * 1024,
  getWeight: (response) => Buffer.byteLength(response.body, 'utf8'),
});
const requestCoordinator = new RequestCoordinator();

const cacheDuration = (method: string): number => {
  if (method === 'user.info') return 60 * 60 * 1000;
  if (method === 'contest.standings') return 10 * 1000;
  if (method === 'contest.list') return 5 * 60 * 1000;
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

const filterSubmissions = (
  body: string,
  handles: string | null,
  participantTypes: string | null,
): string => {
  if (!handles && !participantTypes) return body;

  const selectedHandles = handles ? new Set(handles.split(';')) : null;
  const selectedParticipantTypes = participantTypes ? new Set(participantTypes.split(',')) : null;
  const response = JSON.parse(body) as { result?: Submission[] };
  if (!Array.isArray(response.result)) return body;

  return JSON.stringify({
    ...response,
    result: response.result.filter((submission) => (
      (!selectedHandles
        || submission.author.members.some((member) => selectedHandles.has(member.handle)))
      && (!selectedParticipantTypes
        || selectedParticipantTypes.has(submission.author.participantType))
    )),
  });
};

const fetchCodeforces = async (method: string, parameters: URLSearchParams) => {
  let query = toCodeforcesQuery(parameters);
  if (!anonymousMethods.has(method)) {
    const apiSignature = createSignature(method, parameters);
    query = `${toCodeforcesQuery(parameters)}&apiSig=${apiSignature}`;
  }

  const url = `${CODEFORCES_API_URL}${method}?${query}`;
  if (!freshConnectionMethods.has(method)) {
    const response = await fetch(url);
    return { body: await response.text(), status: response.status };
  }

  const dispatcher = new Agent({ connections: 1, pipelining: 0 });
  try {
    const response = await undiciFetch(url, { dispatcher });
    return { body: await response.text(), status: response.status };
  } finally {
    await dispatcher.close();
  }
};

const getCodeforcesResponse = async (method: string, parameters: URLSearchParams) => {
  const cacheKey = `${method}?${toCodeforcesQuery(parameters)}`;
  const cachedResponse = responseCache.get(cacheKey);
  if (cachedResponse) return cachedResponse;

  return requestCoordinator.run(cacheKey, async () => {
    const response = await fetchCodeforces(method, new URLSearchParams(parameters));
    responseCache.set(cacheKey, response, cacheDuration(method));
    return response;
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

  if (!parameters.get('contestId')
    && ((method.startsWith('contest.') && method !== 'contest.list')
      || method === 'participant.import')) {
    res.status(400).json({ status: 'FAILED', comment: 'contestId is required' });
    return;
  }
  if (method === 'user.info' && !parameters.get('handles')) {
    res.status(400).json({ status: 'FAILED', comment: 'handles is required' });
    return;
  }
  if (method === 'contest.status' && !parameters.get('handles') && !parameters.get('participantTypes')) {
    res.status(400).json({ status: 'FAILED', comment: 'handles or participantTypes is required' });
    return;
  }

  try {
    if (method === 'participant.import') {
      const count = Number(parameters.get('count'));
      const selection = parameters.get('selection');
      if (!Number.isSafeInteger(count) || count <= 0) {
        res.status(400).json({ status: 'FAILED', comment: 'count must be a positive integer' });
        return;
      }
      if (selection !== 'top' && selection !== 'random') {
        res.status(400).json({ status: 'FAILED', comment: 'selection must be top or random' });
        return;
      }

      const standingsParameters = new URLSearchParams({
        contestId: parameters.get('contestId') as string,
      });
      const { body, status } = await getCodeforcesResponse(
        'contest.standings',
        standingsParameters,
      );
      if (status !== 200) {
        res.status(status).send(body);
        return;
      }

      const standingsResponse = JSON.parse(body) as { result: Standings };
      const handles = selectParticipantHandles(
        standingsResponse.result.rows,
        count,
        selection as ParticipantSelection,
        getName,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ status: 'OK', result: handles });
      return;
    }

    if (method === 'contest.info') {
      const contestId = Number(parameters.get('contestId'));
      const listParameters = new URLSearchParams({ gym: String(contestId >= 100_000) });
      const { body, status } = await getCodeforcesResponse('contest.list', listParameters);
      if (status !== 200) {
        res.status(status).send(body);
        return;
      }
      const listResponse = JSON.parse(body) as { status: string; result?: Contest[] };
      const contest = listResponse.result?.find((candidate) => candidate.id === contestId);
      res.setHeader('Cache-Control', 'no-store');
      if (!contest) {
        res.status(404).json({ status: 'FAILED', comment: 'Contest not found' });
        return;
      }
      res.status(200).json({ status: 'OK', result: contest });
      return;
    }

    const handles = method === 'contest.status' ? parameters.get('handles') : null;
    const participantTypes = method === 'contest.status' ? parameters.get('participantTypes') : null;
    if (method === 'contest.status') {
      parameters.delete('handles');
      parameters.delete('participantTypes');
    }
    const { body, status } = await getCodeforcesResponse(method, parameters);

    if (method === 'contest.list' && status === 200) {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }
    res.status(status).send(
      method === 'contest.status' ? filterSubmissions(body, handles, participantTypes) : body,
    );
  } catch (error) {
    const comment = error instanceof Error ? error.message : 'Unable to contact Codeforces';
    res.status(502).json({ status: 'FAILED', comment });
  }
}
