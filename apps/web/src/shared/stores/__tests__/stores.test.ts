import { describe, expect, it, vi } from 'vitest';
import type { AgentStateEvent, BootstrapResponse } from '@aiko/shared';
import { agentStateStore, DEFAULT_AGENT_EMOTION } from '../agent-state-store';
import { conversationStore } from '../conversation-store';
import { createStore } from '../create-store';

const bootstrapData = {
  user: { id: 'local-user' },
  agent: {
    id: 'agent-default',
    slug: 'default',
    displayName: 'Aiko',
    description: null,
    currentState: { valence: -0.1, arousal: -0.04 },
    currentTag: 'low',
    stateUpdatedAt: '2026-11-12T00:00:00.000Z',
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
} as BootstrapResponse;

function makeEvent(id: string): AgentStateEvent {
  return {
    id,
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
    createdAt: '2026-11-12T00:00:01.000Z',
  };
}

describe('createStore', () => {
  it('notifies subscribers only on actual state change', () => {
    const store = createStore({ count: 0 });
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState((prev) => ({ count: prev.count + 1 }));
    store.setState({ count: 1 }); // 相同值不通知
    expect(store.getState().count).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('conversationStore', () => {
  it('follows idle → loading → ready lifecycle', () => {
    conversationStore.reset();
    conversationStore.setLoading();
    expect(conversationStore.getState().status).toBe('loading');
    conversationStore.setBootstrapData(bootstrapData);
    const state = conversationStore.getState();
    expect(state).toMatchObject({
      status: 'ready',
      conversationId: 'conv_1',
      agentId: 'agent-default',
      errorCode: null,
    });
  });

  it('follows idle → loading → error lifecycle', () => {
    conversationStore.reset();
    conversationStore.setLoading();
    conversationStore.setError('AGENT_NOT_FOUND');
    const state = conversationStore.getState();
    expect(state.status).toBe('error');
    expect(state.errorCode).toBe('AGENT_NOT_FOUND');
    expect(state.conversationId).toBeNull();
  });
});

describe('agentStateStore', () => {
  it('initializes from bootstrap agent snapshot', () => {
    agentStateStore.reset();
    agentStateStore.initFromBootstrap(bootstrapData);
    const state = agentStateStore.getState();
    expect(state.state).toEqual({ valence: -0.1, arousal: -0.04 });
    expect(state.discreteTag).toBe('low');
    expect(state.latestEvent).toBeNull();
    expect(state.receivedCount).toBe(0);
  });

  it('applies state events and counts them once', () => {
    agentStateStore.reset();
    const event = makeEvent('state_1');
    agentStateStore.applyStateEvent(event);
    agentStateStore.applyStateEvent(event); // 同 id 去重
    const state = agentStateStore.getState();
    expect(state.latestEvent?.id).toBe('state_1');
    expect(state.state).toEqual(event.after);
    expect(state.receivedCount).toBe(1);
    expect(state.stateUpdatedAt).toBe(event.createdAt);
  });

  it('resets to defaults', () => {
    agentStateStore.applyStateEvent(makeEvent('state_1'));
    agentStateStore.reset();
    expect(agentStateStore.getState()).toMatchObject({
      agentId: null,
      state: DEFAULT_AGENT_EMOTION,
      latestEvent: null,
      receivedCount: 0,
    });
  });
});