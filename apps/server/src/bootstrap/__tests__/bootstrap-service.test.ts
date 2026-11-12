import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@aiko/shared';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { eq } from 'drizzle-orm';
import { agents } from '../../db/schema';
import {
  AgentNotFoundError,
  BOOTSTRAP_MESSAGE_LIMIT,
  bootstrapAgent,
} from '../service';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-12T00:00:00.000Z';

function makeFreshHandle(): DbHandle {
  const dbPath = path.join(
    mkdtempSync(path.join(tmpdir(), 'aiko-bootstrap-')),
    'agent.sqlite',
  );
  const handle = createDb(dbPath);
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
  return handle;
}

let handle: DbHandle;

beforeEach(() => {
  handle = makeFreshHandle();
});

function insertConversation(overrides: Partial<{ id: string; lastMessageAt: string | null; isArchived: number; createdAt: string }> = {}) {
  const values = {
    id: overrides.id ?? `conv_${Math.random().toString(36).slice(2)}`,
    userId: LOCAL_USER_ID,
    agentId: DEFAULT_AGENT_ID,
    title: null,
    lastMessageAt: overrides.lastMessageAt ?? null,
    isArchived: overrides.isArchived ?? 0,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.createdAt ?? NOW,
  };
  handle.db.insert(conversations).values(values).run();
  return values.id;
}

function insertMessage(id: string, conversationId: string, createdAt: string, role: 'user' | 'assistant' = 'user') {
  handle.db.insert(messages).values({
    id,
    conversationId,
    agentId: DEFAULT_AGENT_ID,
    userId: LOCAL_USER_ID,
    role,
    content: `content-${id}`,
    status: 'complete',
    clientMessageId: role === 'user' ? `cmi_${id}` : null,
    errorCode: null,
    metadataJson: null,
    createdAt,
    updatedAt: createdAt,
  }).run();
}

function insertStateEvent(id: string, conversationId: string, createdAt: string, triggerMessageId: string | null = null, source: 'user_message' | 'time_decay' = 'time_decay') {
  handle.db.insert(stateEvents).values({
    id,
    agentId: DEFAULT_AGENT_ID,
    conversationId,
    triggerMessageId,
    source,
    ruleVersion: 'emotion-rules-v1',
    beforeValence: 0,
    beforeArousal: 0,
    deltaValence: -0.1,
    deltaArousal: -0.04,
    afterValence: -0.1,
    afterArousal: -0.04,
    discreteTag: 'low',
    reason: '测试事件',
    evidenceText: '累',
    confidence: 0.7,
    createdAt,
  }).run();
}

import { conversations, messages, stateEvents } from '../../db/schema';

describe('bootstrapAgent (M2.2)', () => {
  it('creates a new conversation on empty database', () => {
    const response = bootstrapAgent(handle, 'default', NOW);

    expect(response.user).toEqual({ id: LOCAL_USER_ID });
    expect(response.agent.id).toBe(DEFAULT_AGENT_ID);
    expect(response.agent.currentTag).toBe('neutral');
    expect(response.conversation.agentId).toBe(DEFAULT_AGENT_ID);
    expect(response.conversation.isArchived).toBe(false);
    expect(response.conversation.id.startsWith('conv_')).toBe(true);
    expect(response.messages).toEqual([]);
    expect(response.latestStateEvent).toBeNull();
    expect(response.settings).toEqual({
      defaultAgentId: DEFAULT_AGENT_ID,
      recentWindowRounds: 15,
      maxContextMessages: 30,
      theme: 'system',
    });
  });

  it('returns the most recent active conversation with ascending messages', () => {
    const oldConv = insertConversation({ id: 'conv_old', createdAt: '2026-11-10T00:00:00.000Z' });
    insertMessage('msg_old_1', oldConv, '2026-11-10T00:00:01.000Z');
    const activeConv = insertConversation({ id: 'conv_active', lastMessageAt: '2026-11-11T12:00:00.000Z', createdAt: '2026-11-11T08:00:00.000Z' });
    insertMessage('msg_a_2', activeConv, '2026-11-11T12:00:00.000Z', 'assistant');
    insertMessage('msg_a_1', activeConv, '2026-11-11T11:59:00.000Z');
    insertStateEvent('state_1', activeConv, '2026-11-11T12:00:00.500Z');

    const response = bootstrapAgent(handle, DEFAULT_AGENT_ID, NOW);

    expect(response.conversation.id).toBe('conv_active');
    expect(response.messages.map((m) => m.id)).toEqual(['msg_a_1', 'msg_a_2']);
    expect(response.messages[1]?.content).toBe('content-msg_a_2');
    expect(response.latestStateEvent?.id).toBe('state_1');
    expect(response.latestStateEvent?.ruleVersion).toBe('emotion-rules-v1');
  });

  it('returns only the latest 30 messages in ascending order', () => {
    const conv = insertConversation({ id: 'conv_many' });
    for (let i = 1; i <= BOOTSTRAP_MESSAGE_LIMIT + 5; i++) {
      const ts = new Date(Date.UTC(2026, 10, 11, 8, 0, i)).toISOString();
      insertMessage(`msg_${i}`, conv, ts);
    }

    const response = bootstrapAgent(handle, 'default', NOW);
    expect(response.messages).toHaveLength(BOOTSTRAP_MESSAGE_LIMIT);
    expect(response.messages[0]?.id).toBe(`msg_${BOOTSTRAP_MESSAGE_LIMIT - 24}`); // 第 6 条开始
    expect(response.messages.at(-1)?.id).toBe(`msg_${BOOTSTRAP_MESSAGE_LIMIT + 5}`);
    const created = response.messages.map((m) => m.createdAt);
    expect([...created].sort()).toEqual(created);
  });

  it('skips archived conversations', () => {
    insertConversation({ id: 'conv_archived', lastMessageAt: '2026-11-11T20:00:00.000Z', isArchived: 1 });
    const active = insertConversation({ id: 'conv_open', lastMessageAt: '2026-11-11T10:00:00.000Z' });
    insertMessage('msg_open_1', active, '2026-11-11T10:00:00.000Z');

    const response = bootstrapAgent(handle, 'default', NOW);
    expect(response.conversation.id).toBe('conv_open');
  });

  it('throws AgentNotFoundError for unknown agent ref', () => {
    expect(() => bootstrapAgent(handle, 'ghost', NOW)).toThrow(AgentNotFoundError);
  });

  it('message-triggered state event keeps triggerMessageId', () => {
    const conv = insertConversation({ id: 'conv_trigger' });
    insertMessage('msg_t_1', conv, '2026-11-11T09:00:00.000Z');
    insertStateEvent('state_t_1', conv, '2026-11-11T09:00:01.000Z', 'msg_t_1', 'user_message');

    const response = bootstrapAgent(handle, 'default', NOW);
    expect(response.latestStateEvent?.triggerMessageId).toBe('msg_t_1');
    expect(response.latestStateEvent?.source).toBe('user_message');
  });
});
describe('bootstrapAgent message ordering (refresh order regression)', () => {
  it('returns same-millisecond messages in insertion order: user before assistant', () => {
    const convId = insertConversation({ id: 'conv_order' });
    // 复现线上缺陷：两条消息 createdAt 相同，且 id 随机字典序与插入序相反
    insertMessage('msg_zzz', convId, NOW, 'user');
    insertMessage('msg_aaa', convId, NOW, 'assistant');

    const response = bootstrapAgent(handle, 'default', NOW);
    expect(response.conversation.id).toBe('conv_order');
    expect(response.messages.map((m) => m.id)).toEqual(['msg_zzz', 'msg_aaa']);
    expect(response.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('applies read-time regression for display without persisting (T6)', () => {
    // 快照 valence 0.4，12 小时前更新（两个半程）→ 展示态回归到 0.1
    handle.db.update(agents).set({
      currentValence: 0.4,
      currentArousal: 0,
      currentDominance: 0,
      stateUpdatedAt: '2026-11-11T12:00:00.000Z',
      updatedAt: '2026-11-11T12:00:00.000Z',
    }).where(eq(agents.id, DEFAULT_AGENT_ID)).run();

    const response = bootstrapAgent(handle, DEFAULT_AGENT_ID, NOW);
    expect(response.agent.currentState.valence).toBeCloseTo(0.1, 5);
    expect(response.agent.decayHalfLifeHours).toBeNull();

    // 读时回归不写库
    const row = handle.db.select().from(agents).where(eq(agents.id, DEFAULT_AGENT_ID)).get()!;
    expect(row.currentValence).toBe(0.4);
  });
});