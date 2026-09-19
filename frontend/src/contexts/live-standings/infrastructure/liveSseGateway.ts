import { encodeHandles } from '@/src/shared/domain/participantHandles';
import type {
  CodeforcesApiResponse,
  CodeforcesStandingsDto,
  CodeforcesSubmissionDto,
} from '@/src/integrations/codeforces/contracts';

export type LiveSnapshot = {
  revision: number;
  contest: CodeforcesStandingsDto['contest'];
  standings: CodeforcesStandingsDto;
  submissions: CodeforcesSubmissionDto[];
  health?: { state?: string };
};

export type LivePatch = {
  revision: number;
  contest: LiveSnapshot['contest'];
  standings: CodeforcesStandingsDto;
  submissionUpserts: CodeforcesSubmissionDto[];
  health?: { state?: string };
};

const baseUrl = () => (process.env.NEXT_PUBLIC_LIVE_API_BASE_URL || '').replace(/\/$/, '');

const readError = async (response: Response, fallback: string) => {
  try {
    const payload = await response.json() as CodeforcesApiResponse<unknown>;
    return payload.comment || fallback;
  } catch {
    return fallback;
  }
};

export const liveSseGateway = {
  enabled: () => baseUrl().length > 0,

  async activate(contestId: string, signal?: AbortSignal) {
    const response = await fetch(`${baseUrl()}/v1/contests/${encodeURIComponent(contestId)}/activate`, {
      method: 'POST',
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(await readError(response, 'Unable to activate live contest'));
    return response.json() as Promise<{ state: string; contest: LiveSnapshot['contest'] }>;
  },

  connect(
    contestId: string,
    handles: string[],
    onSnapshot: (snapshot: LiveSnapshot) => void,
    onPatch: (patch: LivePatch) => void,
    onState: (state: string, contest?: LiveSnapshot['contest']) => void,
    onError: () => void,
  ) {
    const source = new EventSource(
      `${baseUrl()}/v1/contests/${encodeURIComponent(contestId)}/events?h=${encodeHandles(handles)}`,
    );
    source.addEventListener('snapshot', (event) => {
      try { onSnapshot(JSON.parse((event as MessageEvent).data) as LiveSnapshot); } catch { onError(); }
    });
    source.addEventListener('patch', (event) => {
      try { onPatch(JSON.parse((event as MessageEvent).data) as LivePatch); } catch { onError(); }
    });
    source.addEventListener('state', (event) => {
      try {
        const value = JSON.parse((event as MessageEvent).data) as { state: string; contest?: LiveSnapshot['contest'] };
        onState(value.state, value.contest);
      } catch { onError(); }
    });
    source.onerror = onError;
    return source;
  },
};
