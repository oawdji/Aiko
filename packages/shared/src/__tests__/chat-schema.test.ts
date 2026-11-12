import { describe, expect, it } from 'vitest';
import { CHAT_MESSAGE_MAX_LENGTH, ChatRequestBodySchema } from '../schemas/chat';

const validBody = {
  agentId: 'agent-default',
  conversationId: 'conv_1',
  message: '今天好累',
  clientMessageId: 'client_1',
};

describe('ChatRequestBodySchema (M3.1)', () => {
  it('accepts a valid chat request', () => {
    expect(ChatRequestBodySchema.safeParse(validBody).success).toBe(true);
  });

  it('rejects whitespace-only messages', () => {
    expect(ChatRequestBodySchema.safeParse({ ...validBody, message: '   ' }).success).toBe(false);
  });

  it('rejects messages over 8000 UTF-16 chars', () => {
    const long = 'a'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1);
    expect(ChatRequestBodySchema.safeParse({ ...validBody, message: long }).success).toBe(false);
  });

  it('accepts messages at the 8000-char boundary', () => {
    const exact = 'a'.repeat(CHAT_MESSAGE_MAX_LENGTH);
    expect(ChatRequestBodySchema.safeParse({ ...validBody, message: exact }).success).toBe(true);
  });

  it('requires all four fields', () => {
    for (const key of ['agentId', 'conversationId', 'message', 'clientMessageId']) {
      const body: Record<string, string> = { ...validBody };
      delete body[key];
      expect(ChatRequestBodySchema.safeParse(body).success).toBe(false);
    }
  });
});