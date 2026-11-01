import { encodeHandles } from '@/src/shared/domain/participantHandles';
import type { Activation, LiveSnapshot, LivePatch, LiveState } from '@/src/integrations/live-api/contracts';
import { mapContestDto, mapStandingsDto, mapSubmissionDto } from '@/src/integrations/codeforces/mapper';
import type { LiveStreamGateway } from '../application/ports';

const baseUrl = () => (process.env.NEXT_PUBLIC_LIVE_API_BASE_URL || '').replace(/\/$/, '');

const readError = async (response: Response, fallback: string) => {
  try {
    const payload = await response.json() as { comment?: string };
    return payload.comment || fallback;
  } catch {
    return fallback;
  }
};

export const liveSseGateway: LiveStreamGateway = {
  enabled: () => baseUrl().length > 0,

  async activate(contestId: string, signal?: AbortSignal) {
    const response = await fetch(`${baseUrl()}/v1/contests/${encodeURIComponent(contestId)}/activate`, {
      method: 'POST',
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(await readError(response, 'Unable to activate live contest'));
    const value = await response.json() as Activation;
    return { state: value.state, contest: mapContestDto(value.contest) };
  },

  connect(
    contestId: string,
    handles: string[],
    onSnapshot,
    onPatch,
    onState,
    onError,
  ) {
    const source = new EventSource(
      `${baseUrl()}/v1/contests/${encodeURIComponent(contestId)}/events?h=${encodeHandles(handles)}`,
    );
    source.addEventListener('snapshot', (event) => {
      try {
        const value = JSON.parse((event as MessageEvent).data) as LiveSnapshot;
        onSnapshot({
          ...value,
          contest: mapContestDto(value.contest),
          standings: mapStandingsDto(value.standings),
          submissions: value.submissions.map(mapSubmissionDto),
        });
      } catch { onError(); }
    });
    source.addEventListener('patch', (event) => {
      try {
        const value = JSON.parse((event as MessageEvent).data) as LivePatch;
        onPatch({
          ...value,
          contest: mapContestDto(value.contest),
          standings: mapStandingsDto(value.standings),
          submissionUpserts: value.submissionUpserts.map(mapSubmissionDto),
        });
      } catch { onError(); }
    });
    source.addEventListener('state', (event) => {
      try {
        const value = JSON.parse((event as MessageEvent).data) as LiveState;
        onState(value.state, value.contest ? mapContestDto(value.contest) : undefined);
      } catch { onError(); }
    });
    source.onerror = onError;
    return source;
  },
};
