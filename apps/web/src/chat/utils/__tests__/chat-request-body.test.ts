import { describe, expect, it } from 'vitest';
import type { AgentStateEventData } from '@aiko/shared';
import type { AppUIMessage } from '../../types';
import { buildChatRequestBody } from '../chat-request-body';

function userMessage(id: string, text: string): AppUIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
  };
}

function assistantMessage(id: string, text: string): AppUIMessage {
  return {
    id,
    role: 'assistant',
    parts: [{ type: 'text', text }],
  };
}

function stateEventPart(): AppUIMessage['parts'][number] {
  const data: AgentStateEventData = {
    event: {
      id: 'state_1',
      agentId: 'agent-default',
      conversationId: 'conv_1',
      triggerMessageId: 'msg_1',
      source: 'user_message',
      ruleVersion: 'emotion-rules-v1',
      before: { valence: 0, arousal: 0, dominance: 0 },
      delta: { valence: 0, arousal: 0, dominance: 0 },
      after: { valence: 0, arousal: 0, dominance: 0 },
      discreteTag: 'neutral',
      reason: 'reason',
      evidenceText: 'evidence',
      confidence: 0.7,
      createdAt: '2026-11-12T00:00:00.000Z',
    },
  };
  return { type: 'data-agent-state-event', id: 'state_1', data };
}

describe('buildChatRequestBody (contract §13.1)', () => {
  it('maps the last user message into the flat contract body', () => {
    const body = buildChatRequestBody({
      conversationId: 'conv_1',
      agentId: 'agent-default',
      messages: [
        userMessage('u1', '第一条'),
        assistantMessage('a1', '回复'),
        userMessage('u2', '今天好累'),
      ],
    });

    expect(body).toEqual({
      agentId: 'agent-default',
      conversationId: 'conv_1',
      message: '今天好累',
      clientMessageId: 'u2',
    });
  });

  it('joins multiple text parts and ignores non-text parts', () => {
    const message: AppUIMessage = {
      id: 'u1',
      role: 'user',
      parts: [
        { type: 'text', text: '你好' },
        stateEventPart(),
        { type: 'text', text: '，Aiko' },
      ],
    };

    const body = buildChatRequestBody({
      conversationId: 'conv_1',
      agentId: 'agent-default',
      messages: [message],
    });
    expect(body.message).toBe('你好，Aiko');
    expect(body.clientMessageId).toBe('u1');
  });

  it('falls back to a generated clientMessageId when no user message exists', () => {
    const body = buildChatRequestBody({
      conversationId: 'conv_1',
      agentId: 'agent-default',
      messages: [],
    });
    expect(body.clientMessageId).toBeTruthy();
    expect(body.message).toBe('');
  });

  it('keeps clientMessageId stable for the same user message (idempotency)', () => {
    const messages = [userMessage('u1', '同一句话')];
    const first = buildChatRequestBody({
      conversationId: 'conv_1',
      agentId: 'agent-default',
      messages,
    });
    const second = buildChatRequestBody({
      conversationId: 'conv_1',
      agentId: 'agent-default',
      messages,
    });
    expect(first.clientMessageId).toBe(second.clientMessageId);
  });
});