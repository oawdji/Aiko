import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../errors';
import { fetchBootstrap, fetchConversation } from '../chat-recovery';

const okBootstrap = {
  user: { id: 'local-user' },
  agent: {
    id: 'agent-default',
    slug: 'default',
    displayName: 'Aiko',
    description: null,
    currentState: { valence: 0, arousal: 0, dominance: 0 },
    currentTag: 'neutral',
    stateUpdatedAt: null,
    emotionBaseline: { valence: 0, arousal: 0, dominance: 0 },
    decayHalfLifeHours: 6,
    personaVersion: 1,
  },
  conversation: {
    id: 'conv_1',
    agentId: 'agent-default',
    title: null,
    lastMessageAt: null,
    isArchived: false,
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:00.000Z',
  },
  messages: [],
  latestStateEvent: null,
  settings: {
    defaultAgentId: 'agent-default',
    recentWindowRounds: 15,
    maxContextMessages: 30,
    theme: 'system',
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('web API client (M2.4)', () => {
  it('fetches bootstrap with agent query and validates via shared schema', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(okBootstrap));
    vi.stubGlobal('fetch', fetchMock);

    const data = await fetchBootstrap('default');
    expect(data.agent.slug).toBe('default');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/bootstrap?agent=default',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('builds conversation pagination query with limit and beforeId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        conversation: okBootstrap.conversation,
        agent: okBootstrap.agent,
        messages: [],
        latestStateEvent: null,
        nextPage: null,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchConversation('conv_1', { limit: 30, beforeId: 'msg_1' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/conversations/conv_1?limit=30&beforeId=msg_1',
      expect.anything(),
    );
  });

  it('normalizes server ApiError responses into ApiClientError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ code: 'AGENT_NOT_FOUND', message: 'Agent "x" not found' }, 404),
      ),
    );

    const error = await fetchBootstrap('x').catch((e) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.code).toBe('AGENT_NOT_FOUND');
    expect(error.status).toBe(404);
  });

  it('wraps network failures as NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const error = await fetchBootstrap().catch((e) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.code).toBe('NETWORK_ERROR');
  });

  it('rejects contract-violating 200 responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ foo: 'bar' })));
    const error = await fetchBootstrap().catch((e) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.code).toBe('RESPONSE_CONTRACT_VIOLATION');
  });

  it('supports external abort signal', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')),
    );
    const error = await fetchBootstrap(undefined, { signal: controller.signal }).catch((e) => e);
    expect(error.code).toBe('CLIENT_ABORTED');
  });
});