import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateProactive,
  fetchProactiveHistory,
} from '../../../proactive/api/proactive-api';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('proactive-api domain functions', () => {
  it('evaluates via POST with local minutes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        send: true,
        reason: null,
        message: {
          id: 'msg_1',
          conversationId: 'conv_1',
          content: '想起来你说过在学做饭',
          strategy: 'memory_recall',
          createdAt: '2026-11-17T12:00:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = await evaluateProactive({ conversationId: 'conv_1', localMinutesOfDay: 1200 });
    expect(r.send).toBe(true);
    expect(r.message!.strategy).toBe('memory_recall');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/proactive/evaluate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('parses suppressed response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ send: false, reason: 'quiet_hours', message: null }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await evaluateProactive({ conversationId: 'conv_1', localMinutesOfDay: 1380 });
    expect(r.send).toBe(false);
    expect(r.reason).toBe('quiet_hours');
    expect(r.message).toBeNull();
  });

  it('fetches history', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        messages: [
          {
            id: 'pam_1',
            conversationId: 'conv_1',
            strategy: 'emotion_care',
            evidenceText: 'valence -0.60',
            createdAt: '2026-11-17T12:00:00.000Z',
            content: '昨天你好像不太开心，现在好些了吗？',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchProactiveHistory();
    expect(r.messages).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/proactive/history',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
