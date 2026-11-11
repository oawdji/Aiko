import { describe, expect, it } from 'vitest';
import { devMockChatRoute } from '../api/dev-mock-chat';

function requestBody(text: string) {
  return JSON.stringify({
    id: 'test-chat',
    messages: [
      {
        id: 'm1',
        role: 'user',
        parts: [{ type: 'text', text }],
      },
    ],
  });
}

describe('dev mock chat protocol (T0.3)', () => {
  it('returns 409 DUPLICATE_CLIENT_MESSAGE for messages containing 409', async () => {
    const res = await devMockChatRoute.request('/dev/mock-chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: requestBody('请触发409'),
    });

    expect(res.status).toBe(409);
    const data = (await res.json()) as { code: string };
    expect(data.code).toBe('DUPLICATE_CLIENT_MESSAGE');
  });

  it('streams state data part before text deltas', async () => {
    const res = await devMockChatRoute.request('/dev/mock-chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: requestBody('你好'),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const body = await res.text();
    const stateIndex = body.indexOf('data-agent-state-event');
    const textIndex = body.indexOf('text-delta');
    expect(stateIndex).toBeGreaterThan(-1);
    expect(textIndex).toBeGreaterThan(stateIndex);
    expect(body).toContain('"delta"');
  });
});