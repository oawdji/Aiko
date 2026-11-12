import { describe, expect, it } from 'vitest';
import { CHAT_MESSAGE_MAX_LENGTH } from '@aiko/shared';
import { chatRoute } from '../route';

const validBody = {
  agentId: 'agent-default',
  conversationId: 'conv_1',
  message: '今天好累',
  clientMessageId: 'client_1',
};

type ErrorBody = { code: string; message: string; details?: Record<string, unknown> };

function post(body: string, headers: Record<string, string> = {}) {
  return chatRoute.request('/chat', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('POST /api/chat validation (M3.1)', () => {
  it('rejects invalid JSON with 400 INVALID_REQUEST', async () => {
    const res = await post('{not-json');
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.code).toBe('INVALID_REQUEST');
  });

  it('rejects missing fields with 400 and field details', async () => {
    const res = await post(JSON.stringify({ agentId: '', message: 'hi' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.code).toBe('INVALID_REQUEST');
    expect(body.details).toHaveProperty('conversationId');
    expect(body.details).toHaveProperty('clientMessageId');
  });

  it('rejects whitespace-only message with 400', async () => {
    const res = await post(JSON.stringify({ ...validBody, message: '   ' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).code).toBe('INVALID_REQUEST');
  });

  it('rejects over-length message with 413 MESSAGE_TOO_LONG', async () => {
    const res = await post(
      JSON.stringify({ ...validBody, message: 'a'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1) }),
    );
    expect(res.status).toBe(413);
    expect(((await res.json()) as ErrorBody).code).toBe('MESSAGE_TOO_LONG');
  });

  it('rejects oversized request body via content-length with 413', async () => {
    const res = await post(JSON.stringify(validBody), {
      'Content-Length': String(128 * 1024 + 1),
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as ErrorBody).code).toBe('MESSAGE_TOO_LONG');
  });

  it('passes validation and reaches the pipeline stub (500 until M3.2)', async () => {
    const res = await post(JSON.stringify(validBody));
    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorBody;
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toContain('M3.2');
  });
});