import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@aiko/shared';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { conversations, messages, stateEvents } from '../../db/schema';
import { createMemory } from '../../memories/service';
import {
  ConversationNotFoundError,
  clearConversations,
  deleteConversation,
  getConversationDetail,
} from '../service';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-16T00:00:00.000Z';
const OWNER = { userId: LOCAL_USER_ID, agentId: DEFAULT_AGENT_ID };

function makeFreshHandle(): DbHandle {
  const dbPath = path.join(
    mkdtempSync(path.join(tmpdir(), 'aiko-conv-delete-')),
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

function insertConversation(id: string) {
  handle.db.insert(conversations).values({
    id,
    userId: LOCAL_USER_ID,
    agentId: DEFAULT_AGENT_ID,
    title: null,
    lastMessageAt: null,
    isArchived: 0,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();
}

function insertMessage(id: string, conversationId: string) {
  handle.db.insert(messages).values({
    id,
    conversationId,
    agentId: DEFAULT_AGENT_ID,
    userId: LOCAL_USER_ID,
    role: 'user',
    content: 'content-' + id,
    status: 'complete',
    clientMessageId: 'cm-' + id,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();
}

function insertStateEvent(id: string, conversationId: string, triggerMessageId: string) {
  handle.db.insert(stateEvents).values({
    id,
    agentId: DEFAULT_AGENT_ID,
    conversationId,
    triggerMessageId,
    source: 'user_message',
    ruleVersion: 'emotion-llm-v2',
    beforeValence: 0,
    beforeArousal: 0,
    beforeDominance: 0,
    deltaValence: 0.1,
    deltaArousal: 0,
    deltaDominance: 0,
    afterValence: 0.1,
    afterArousal: 0,
    afterDominance: 0,
    discreteTag: 'calm',
    reason: 'test',
    evidenceText: 'test',
    confidence: 0.9,
    createdAt: NOW,
  }).run();
}

/** createMemory 自行生成随机 id，返回真实主键供断言使用。 */
function insertMemory(id: string, sourceMessageId: string): string {
  const { memory } = createMemory(handle, {
    owner: OWNER,
    type: 'fact',
    content: 'mem-' + id,
    sourceMessageId,
    confidence: 0.9,
    memoryPad: { v: 0, a: 0, d: 0 },
    arousal: 0,
    halfLifeHours: 72,
    now: NOW,
  });
  return memory.id;
}

function count(sql: string): number {
  return (handle.sqlite.prepare(sql).get() as { n: number }).n;
}

describe('conversations: delete single', () => {
  it('removes children, keeps memories with nulled source, keeps other conversations', () => {
    insertConversation('conv_a');
    insertMessage('msg_a1', 'conv_a');
    insertStateEvent('state_a', 'conv_a', 'msg_a1');
    const memA = insertMemory('mem_1', 'msg_a1');
    insertConversation('conv_b');
    insertMessage('msg_b1', 'conv_b');
    const memB = insertMemory('mem_2', 'msg_b1');

    const result = deleteConversation(handle, 'conv_a');
    expect(result.count).toBe(1);
    expect(typeof result.deletedAt).toBe('string');

    expect(() => getConversationDetail(handle, 'conv_a')).toThrow(ConversationNotFoundError);
    expect(count("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = 'conv_a'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM state_events WHERE conversation_id = 'conv_a'")).toBe(0);

    // 记忆保留，来源链接解除（ON DELETE SET NULL）
    const memRow = handle.sqlite
      .prepare('SELECT source_message_id FROM memories WHERE id = ?')
      .get(memA) as { source_message_id: string | null };
    expect(memRow.source_message_id).toBeNull();

    // 其他会话不受影响
    expect(() => getConversationDetail(handle, 'conv_b')).not.toThrow();
    const mem2 = handle.sqlite
      .prepare('SELECT source_message_id FROM memories WHERE id = ?')
      .get(memB) as { source_message_id: string | null };
    expect(mem2.source_message_id).toBe('msg_b1');
  });

  it('throws ConversationNotFoundError for unknown id', () => {
    expect(() => deleteConversation(handle, 'conv_none')).toThrow(ConversationNotFoundError);
  });
});

describe('conversations: clear all', () => {
  it('removes all conversations and children, keeps memories', () => {
    insertConversation('conv_a');
    insertMessage('msg_a1', 'conv_a');
    insertStateEvent('state_a', 'conv_a', 'msg_a1');
    insertMemory('mem_1', 'msg_a1');
    insertConversation('conv_b');
    insertMessage('msg_b1', 'conv_b');
    insertMemory('mem_2', 'msg_b1');

    const result = clearConversations(handle);
    expect(result.count).toBe(2);
    expect(count('SELECT COUNT(*) AS n FROM conversations')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM messages')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM state_events')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM memories')).toBe(2);
    const mem = handle.sqlite
      .prepare('SELECT source_message_id FROM memories')
      .all() as { source_message_id: string | null }[];
    expect(mem.every((m) => m.source_message_id === null)).toBe(true);
  });

  it('is idempotent on an empty store (count = 0)', () => {
    expect(clearConversations(handle).count).toBe(0);
  });
});
