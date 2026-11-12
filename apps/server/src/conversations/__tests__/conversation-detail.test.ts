import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@aiko/shared';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { conversations, messages, stateEvents } from '../../db/schema';
import {
  ConversationNotFoundError,
  CursorMessageNotFoundError,
  MESSAGE_PAGE_LIMIT_MAX,
  getConversationDetail,
} from '../service';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-12T00:00:00.000Z';

function makeFreshHandle(): DbHandle {
  const dbPath = path.join(
    mkdtempSync(path.join(tmpdir(), 'aiko-conversations-')),
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

function ts(second: number) {
  return new Date(Date.UTC(2026, 10, 11, 8, 0, second)).toISOString();
}

function insertConversation(id: string, overrides: Partial<{ lastMessageAt: string; isArchived: number }> = {}) {
  handle.db.insert(conversations).values({
    id,
    userId: LOCAL_USER_ID,
    agentId: DEFAULT_AGENT_ID,
    title: null,
    lastMessageAt: overrides.lastMessageAt ?? null,
    isArchived: overrides.isArchived ?? 0,
    createdAt: ts(0),
    updatedAt: ts(0),
  }).run();
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

function insertStateEvent(id: string, conversationId: string, createdAt: string) {
  handle.db.insert(stateEvents).values({
    id,
    agentId: DEFAULT_AGENT_ID,
    conversationId,
    triggerMessageId: null,
    source: 'time_decay',
    ruleVersion: 'emotion-rules-v1',
    beforeValence: 0,
    beforeArousal: 0,
    deltaValence: 0.1,
    deltaArousal: 0.05,
    afterValence: 0.1,
    afterArousal: 0.05,
    discreteTag: 'happy',
    reason: '测试',
    evidenceText: '',
    confidence: 0.5,
    createdAt,
  }).run();
}

describe('getConversationDetail (M2.3)', () => {
  it('returns messages in ascending order with agent and latest state event', () => {
    insertConversation('conv_1', { lastMessageAt: ts(30) });
    for (let i = 1; i <= 5; i++) insertMessage(`msg_${i}`, 'conv_1', ts(i * 10));
    insertStateEvent('state_1', 'conv_1', ts(31));

    const response = getConversationDetail(handle, 'conv_1');

    expect(response.conversation.id).toBe('conv_1');
    expect(response.agent.id).toBe(DEFAULT_AGENT_ID);
    expect(response.messages.map((m) => m.id)).toEqual(['msg_1', 'msg_2', 'msg_3', 'msg_4', 'msg_5']);
    expect(response.latestStateEvent?.id).toBe('state_1');
    expect(response.nextPage).toBeNull();
  });

  it('paginates with limit and returns nextPage pointing at oldest visible message', () => {
    insertConversation('conv_1');
    for (let i = 1; i <= 7; i++) insertMessage(`msg_${i}`, 'conv_1', ts(i * 10));

    const page1 = getConversationDetail(handle, 'conv_1', { limit: 3 });
    expect(page1.messages.map((m) => m.id)).toEqual(['msg_5', 'msg_6', 'msg_7']);
    expect(page1.nextPage).toEqual({ limit: 3, beforeId: 'msg_5' });

    const page2 = getConversationDetail(handle, 'conv_1', { limit: 3, beforeId: page1.nextPage!.beforeId });
    expect(page2.messages.map((m) => m.id)).toEqual(['msg_2', 'msg_3', 'msg_4']);
    expect(page2.nextPage).toEqual({ limit: 3, beforeId: 'msg_2' });

    const page3 = getConversationDetail(handle, 'conv_1', { limit: 3, beforeId: 'msg_2' });
    expect(page3.messages.map((m) => m.id)).toEqual(['msg_1']);
    expect(page3.nextPage).toBeNull();
  });

  it('keeps same-second messages stable across cursor pages', () => {
    insertConversation('conv_tie');
    insertMessage('msg_tie_a', 'conv_tie', ts(10));
    insertMessage('msg_tie_b', 'conv_tie', ts(10));
    insertMessage('msg_tie_c', 'conv_tie', ts(10));

    const page1 = getConversationDetail(handle, 'conv_tie', { limit: 2 });
    expect(page1.messages.map((m) => m.id)).toEqual(['msg_tie_b', 'msg_tie_c']);
    expect(page1.nextPage?.beforeId).toBe('msg_tie_b');

    const page2 = getConversationDetail(handle, 'conv_tie', { limit: 2, beforeId: 'msg_tie_b' });
    expect(page2.messages.map((m) => m.id)).toEqual(['msg_tie_a']);
    expect(page2.nextPage).toBeNull();
  });

  it('uses agent-level latest state event even when scoped to another conversation', () => {
    insertConversation('conv_1');
    insertConversation('conv_2', { lastMessageAt: ts(50) });
    insertMessage('msg_c1', 'conv_1', ts(10));
    insertMessage('msg_c2', 'conv_2', ts(50));
    insertStateEvent('state_old', 'conv_1', ts(11));
    insertStateEvent('state_new', 'conv_2', ts(51));

    const response = getConversationDetail(handle, 'conv_1');
    expect(response.latestStateEvent?.id).toBe('state_new');
  });

  it('throws ConversationNotFoundError for unknown conversation', () => {
    expect(() => getConversationDetail(handle, 'conv_ghost')).toThrow(ConversationNotFoundError);
  });

  it('rejects beforeId that does not belong to the conversation', () => {
    insertConversation('conv_1');
    insertConversation('conv_2');
    insertMessage('msg_other', 'conv_2', ts(10));
    insertMessage('msg_mine', 'conv_1', ts(10));

    expect(() => getConversationDetail(handle, 'conv_1', { beforeId: 'msg_other' })).toThrow(
      CursorMessageNotFoundError,
    );
    expect(() => getConversationDetail(handle, 'conv_1', { beforeId: 'msg_mine' })).not.toThrow();
  });

  it('rejects out-of-range limit', () => {
    insertConversation('conv_1');
    expect(() => getConversationDetail(handle, 'conv_1', { limit: 0 })).toThrow(RangeError);
    expect(() => getConversationDetail(handle, 'conv_1', { limit: MESSAGE_PAGE_LIMIT_MAX + 1 })).toThrow(RangeError);
    expect(() => getConversationDetail(handle, 'conv_1', { limit: 2.5 })).toThrow(RangeError);
  });
});