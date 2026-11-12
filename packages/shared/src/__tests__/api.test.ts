import { describe, expect, it } from 'vitest';

import {
  AppSettingsSchema,
  BootstrapResponseSchema,
  LlmConnectionInfoSchema,
  MessagePageQuerySchema,
  StateEventPageQuerySchema,
  UpdateSettingsRequestBodySchema,
} from '../schemas/api';

const baseMessage = {
  id: 'msg_1',
  conversationId: 'conv_1',
  agentId: 'agent-default',
  role: 'user',
  content: '今天好累',
  status: 'complete',
  errorCode: null,
  createdAt: '2026-11-11T08:29:59.000Z',
};

const baseStateEvent = {
  id: 'state_1',
  agentId: 'agent-default',
  conversationId: 'conv_1',
  triggerMessageId: 'msg_1',
  source: 'user_message',
  ruleVersion: 'emotion-rules-v1',
  before: { valence: 0, arousal: 0 },
  delta: { valence: -0.1, arousal: -0.04 },
  after: { valence: -0.1, arousal: -0.04 },
  discreteTag: 'low',
  reason: '累',
  evidenceText: '累',
  confidence: 0.7,
  createdAt: '2026-11-11T08:30:00.000Z',
};

describe('api schemas (M2.1)', () => {
  it('parses a complete bootstrap response', () => {
    const response = {
      user: { id: 'local-user' },
      agent: {
        id: 'agent-default',
        slug: 'default',
        displayName: 'Aiko',
        description: null,
        currentState: { valence: -0.1, arousal: -0.04 },
        currentTag: 'low',
        stateUpdatedAt: '2026-11-11T08:30:00.000Z',
        personaVersion: 1,
      },
      conversation: {
        id: 'conv_1',
        agentId: 'agent-default',
        title: null,
        lastMessageAt: '2026-11-11T08:30:00.000Z',
        isArchived: false,
        createdAt: '2026-11-11T08:00:00.000Z',
        updatedAt: '2026-11-11T08:30:00.000Z',
      },
      messages: [baseMessage],
      latestStateEvent: baseStateEvent,
      settings: {
        defaultAgentId: 'agent-default',
        recentWindowRounds: 15,
        maxContextMessages: 30,
        theme: 'system',
      },
    };

    expect(BootstrapResponseSchema.safeParse(response).success).toBe(true);
  });

  it('rejects message-triggered state events without triggerMessageId', () => {
    const result = BootstrapResponseSchema.safeParse({
      user: { id: 'local-user' },
      agent: {
        id: 'agent-default',
        slug: 'default',
        displayName: 'Aiko',
        description: null,
        currentState: { valence: 0, arousal: 0 },
        currentTag: 'neutral',
        stateUpdatedAt: null,
        personaVersion: 1,
      },
      conversation: {
        id: 'conv_1',
        agentId: 'agent-default',
        title: null,
        lastMessageAt: null,
        isArchived: false,
        createdAt: '2026-11-11T08:00:00.000Z',
        updatedAt: '2026-11-11T08:00:00.000Z',
      },
      messages: [],
      latestStateEvent: { ...baseStateEvent, triggerMessageId: null },
      settings: {
        defaultAgentId: 'agent-default',
        recentWindowRounds: 15,
        maxContextMessages: 30,
        theme: 'system',
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects non-ISO timestamps', () => {
    expect(
      BootstrapResponseSchema.safeParse({
        user: { id: 'local-user' },
        agent: {
          id: 'a',
          slug: 's',
          displayName: 'A',
          description: null,
          currentState: { valence: 0, arousal: 0 },
          currentTag: 'neutral',
          stateUpdatedAt: null,
          personaVersion: 1,
        },
        conversation: {
          id: 'c',
          agentId: 'a',
          title: null,
          lastMessageAt: 'not-a-date',
          isArchived: false,
          createdAt: '2026-11-11T08:00:00.000Z',
          updatedAt: '2026-11-11T08:00:00.000Z',
        },
        messages: [],
        latestStateEvent: null,
        settings: {
          defaultAgentId: 'a',
          recentWindowRounds: 10,
          maxContextMessages: 20,
          theme: 'light',
        },
      }).success,
    ).toBe(false);
  });

  it('coerces and bounds message page queries', () => {
    expect(MessagePageQuerySchema.parse({})).toEqual({});
    expect(MessagePageQuerySchema.parse({ limit: '30', beforeId: 'msg_1' })).toEqual({
      limit: 30,
      beforeId: 'msg_1',
    });
    expect(MessagePageQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(MessagePageQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('bounds state event page queries to 200', () => {
    expect(StateEventPageQuerySchema.safeParse({ limit: 200 }).success).toBe(true);
    expect(StateEventPageQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
  });

  it('enforces maxContextMessages equals recentWindowRounds * 2', () => {
    const valid = { defaultAgentId: 'a', recentWindowRounds: 12, maxContextMessages: 24, theme: 'dark' };
    const invalid = { ...valid, maxContextMessages: 30 };
    expect(AppSettingsSchema.safeParse(valid).success).toBe(true);
    expect(AppSettingsSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects hint when api key is not configured', () => {
    expect(
      LlmConnectionInfoSchema.safeParse({
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        apiKeyConfigured: false,
        apiKeyHint: null,
      }).success,
    ).toBe(true);
    expect(
      LlmConnectionInfoSchema.safeParse({
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        apiKeyConfigured: false,
        apiKeyHint: 'sk-***x3f',
      }).success,
    ).toBe(false);
  });

  it('validates settings update relationships', () => {
    expect(UpdateSettingsRequestBodySchema.safeParse({ theme: 'dark' }).success).toBe(true);
    expect(
      UpdateSettingsRequestBodySchema.safeParse({ recentWindowRounds: 10, maxContextMessages: 30 })
        .success,
    ).toBe(false);
    expect(UpdateSettingsRequestBodySchema.safeParse({ llmApiKey: null }).success).toBe(true);
    expect(UpdateSettingsRequestBodySchema.safeParse({ llmApiKey: '' }).success).toBe(false);
  });
});