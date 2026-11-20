import { mkdtempSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@aiko/shared';
import { conversations, messages, stateEvents } from '../../db/schema';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { createMemory } from '../../memories/service';
import type { PersonaCompleteFn } from '../../persona/llm';
import { ProactiveConversationNotFoundError, evaluateProactive } from '../service';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const T0 = '2026-11-17T12:00:00.000Z';
const T0_MS = Date.parse(T0);
const LOCAL_MINUTES = 20 * 60; // 本地 20:00（UTC+8），非免打扰
let handle: DbHandle;

beforeAll(() => {
  handle = createDb(path.join(mkdtempSync(path.join(tmpdir(), 'aiko-proactive-svc-')), 'agent.sqlite'));
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, T0);
  handle.db.insert(conversations).values({
    id: 'conv_pro',
    userId: LOCAL_USER_ID,
    agentId: DEFAULT_AGENT_ID,
    title: null,
    lastMessageAt: null,
    isArchived: 0,
    createdAt: T0,
    updatedAt: T0,
  }).run();
});

function hoursAgoIso(n: number): string {
  return new Date(T0_MS - n * 3600000).toISOString();
}

/** 每个用例独立状态：清主动审计/消息/记忆/情绪事件，关闭开关。 */
beforeEach(() => {
  // 清理顺序：RESTRICT 外键的子表先行（state_events/memories 引用 messages）
  handle.sqlite.prepare('DELETE FROM proactive_messages').run();
  handle.sqlite.prepare('DELETE FROM state_events').run();
  handle.sqlite.prepare('DELETE FROM memories').run();
  handle.sqlite.prepare("DELETE FROM messages WHERE conversation_id = 'conv_pro'").run();
  handle.sqlite
    .prepare("UPDATE app_settings SET value_json = 'false' WHERE key = 'proactive_enabled'")
    .run();
});

function enable(): void {
  handle.sqlite
    .prepare("UPDATE app_settings SET value_json = 'true' WHERE key = 'proactive_enabled'")
    .run();
}

function insertUserMessage(id: string, createdAt: string): void {
  handle.db.insert(messages).values({
    id,
    conversationId: 'conv_pro',
    agentId: DEFAULT_AGENT_ID,
    userId: LOCAL_USER_ID,
    role: 'user',
    content: 'content-' + id,
    status: 'complete',
    clientMessageId: 'cm-' + id,
    createdAt,
    updatedAt: createdAt,
  }).run();
}

function insertProactiveAudit(id: string, createdAt: string): void {
  const msgId = 'msg_' + id;
  handle.db.insert(messages).values({
    id: msgId,
    conversationId: 'conv_pro',
    agentId: DEFAULT_AGENT_ID,
    userId: LOCAL_USER_ID,
    role: 'assistant',
    content: 'proactive-' + id,
    status: 'complete',
    clientMessageId: null,
    errorCode: null,
    createdAt,
    updatedAt: createdAt,
  }).run();
  handle.sqlite
    .prepare(
      "INSERT INTO proactive_messages (id, agent_id, conversation_id, message_id, strategy, reason, evidence_text, created_at) VALUES (?, ?, 'conv_pro', ?, 'memory_recall', 'idle', 'evidence', ?)",
    )
    .run(id, DEFAULT_AGENT_ID, msgId, createdAt);
}

function insertNegativeEmotion(id: string, createdAt: string, triggerMessageId: string): void {
  handle.db.insert(stateEvents).values({
    id,
    agentId: DEFAULT_AGENT_ID,
    conversationId: 'conv_pro',
    triggerMessageId,
    source: 'user_message',
    ruleVersion: 'emotion-llm-v2',
    beforeValence: 0,
    beforeArousal: 0,
    beforeDominance: 0,
    deltaValence: -0.6,
    deltaArousal: 0,
    deltaDominance: 0,
    afterValence: -0.6,
    afterArousal: 0,
    afterDominance: 0,
    discreteTag: 'low',
    reason: 'test',
    evidenceText: 'test',
    confidence: 0.9,
    createdAt,
  }).run();
}

function insertOldMemory(content: string): string {
  const srcId = 'msg_src_' + randomUUID().slice(0, 8);
  handle.db.insert(messages).values({
    id: srcId,
    conversationId: 'conv_pro',
    agentId: DEFAULT_AGENT_ID,
    userId: LOCAL_USER_ID,
    role: 'user',
    content,
    status: 'complete',
    clientMessageId: 'cm-' + srcId,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  }).run();
  const { memory } = createMemory(handle, {
    owner: { userId: LOCAL_USER_ID, agentId: DEFAULT_AGENT_ID },
    type: 'fact',
    content,
    sourceMessageId: srcId,
    confidence: 0.9,
    memoryPad: { v: 0, a: 0, d: 0 },
    arousal: 0,
    halfLifeHours: 72,
    now: '2026-11-01T00:00:00.000Z',
  });
  return memory.id;
}

function makeComplete(reply: string): PersonaCompleteFn {
  return async () => reply;
}

function evaluate(localMinutes = LOCAL_MINUTES, conversationId = 'conv_pro') {
  return evaluateProactive(
    handle,
    { agentId: DEFAULT_AGENT_ID, conversationId, localMinutesOfDay: localMinutes, now: T0 },
    makeComplete('想起来你说过在学做饭，最近练得怎么样啦？'),
  );
}

describe('evaluateProactive: 时机守门（policy）', () => {
  it('disabled by default even when eligible', async () => {
    // 不开启（seed 默认即关闭）
    insertUserMessage('msg_idle1', hoursAgoIso(2));
    const r = await evaluate();
    expect(r.send).toBe(false);
    expect(r.reason).toBe('disabled');
  });

  it('quiet hours blocks when enabled', async () => {
    enable();
    insertUserMessage('msg_idle2', hoursAgoIso(2));
    const r = await evaluate(23 * 60); // 本地 23:00
    expect(r.send).toBe(false);
    expect(r.reason).toBe('quiet_hours');
  });

  it('not idle when user messaged recently', async () => {
    enable();
    insertUserMessage('msg_idle3', hoursAgoIso(0.2)); // 12 分钟前
    const r = await evaluate();
    expect(r.reason).toBe('not_idle');
  });

  it('cooldown after a recent proactive', async () => {
    enable();
    insertUserMessage('msg_idle4', hoursAgoIso(2));
    insertProactiveAudit('pa_1', hoursAgoIso(0.5));
    const r = await evaluate();
    expect(r.reason).toBe('cooldown');
  });

  it('daily cap blocks at limit', async () => {
    enable();
    insertUserMessage('msg_idle5', hoursAgoIso(2));
    insertProactiveAudit('pa_c1', hoursAgoIso(20));
    insertProactiveAudit('pa_c2', hoursAgoIso(10));
    insertProactiveAudit('pa_c3', hoursAgoIso(5));
    const r = await evaluate();
    expect(r.reason).toBe('daily_cap');
  });
});

describe('evaluateProactive: 内容策略', () => {
  it('emotion care wins for old negative emotion', async () => {
    enable();
    insertUserMessage('msg_ec', hoursAgoIso(2));
    insertNegativeEmotion('state_neg', hoursAgoIso(48), 'msg_ec');
    // 维度门控：依赖 ≥ 0.4 才允许 emotion_care
    handle.sqlite
      .prepare('INSERT INTO relationship_dimensions (agent_id, dependency, updated_at) VALUES (?, ?, ?)')
      .run(DEFAULT_AGENT_ID, 0.5, T0);
    const r = await evaluate();
    expect(r.send).toBe(true);
    expect(r.message!.strategy).toBe('emotion_care');
    expect(r.message!.content.length).toBeGreaterThan(0);
    // 落库断言
    const msgRow = handle.sqlite
      .prepare('SELECT role, metadata_json FROM messages WHERE id = ?')
      .get(r.message!.id) as { role: string; metadata_json: string };
    expect(msgRow.role).toBe('assistant');
    expect(msgRow.metadata_json).toContain('"proactive":true');
    const audit = handle.sqlite
      .prepare("SELECT COUNT(*) AS n FROM proactive_messages WHERE strategy = 'emotion_care'")
      .get() as { n: number };
    expect(audit.n).toBe(1);
  });

  it('emotion care respects its own cooldown', async () => {
    enable();
    insertUserMessage('msg_ec2', hoursAgoIso(2));
    insertNegativeEmotion('state_neg2', hoursAgoIso(48), 'msg_ec2');
    // 近期已有一次 emotion_care（7 天冷却内）
    insertProactiveAudit('pa_ec', hoursAgoIso(30));
    handle.sqlite
      .prepare("UPDATE proactive_messages SET strategy = 'emotion_care' WHERE id = 'pa_ec'")
      .run();
    const r = await evaluate();
    expect(r.send).toBe(true);
    // 冷却内不关怀 → 落到记忆回想或好奇提问
    expect(r.message!.strategy).not.toBe('emotion_care');
  });

  it('memory recall picks an old active memory', async () => {
    enable();
    insertUserMessage('msg_mr', hoursAgoIso(2));
    insertOldMemory('用户正在学做饭');
    // 维度门控：熟悉 ≥ 0.4 才允许 memory_recall
    handle.sqlite
      .prepare('INSERT OR REPLACE INTO relationship_dimensions (agent_id, familiarity, updated_at) VALUES (?, ?, ?)')
      .run(DEFAULT_AGENT_ID, 0.5, T0);
    const r = await evaluate();
    expect(r.send).toBe(true);
    expect(r.message!.strategy).toBe('memory_recall');
  });

  it('falls back to curious question on recent topic', async () => {
    enable();
    insertUserMessage('msg_cq', hoursAgoIso(2));
    const r = await evaluate();
    expect(r.send).toBe(true);
    expect(r.message!.strategy).toBe('curious_question');
  });

  it('generation failure degrades to send:false without writing', async () => {
    enable();
    insertUserMessage('msg_gf', hoursAgoIso(2));
    const failing: PersonaCompleteFn = async () => {
      throw new Error('LLM down');
    };
    const r = await evaluateProactive(
      handle,
      { agentId: DEFAULT_AGENT_ID, conversationId: 'conv_pro', localMinutesOfDay: LOCAL_MINUTES, now: T0 },
      failing,
    );
    expect(r.send).toBe(false);
    expect(r.reason).toBe('generation_failed');
    const n = handle.sqlite
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = 'conv_pro' AND role = 'assistant'")
      .get() as { n: number };
    expect(n.n).toBe(0);
  });

  it('throws for conversation not owned by agent', async () => {
    enable();
    await expect(
      evaluateProactive(
        handle,
        { agentId: DEFAULT_AGENT_ID, conversationId: 'conv_other', localMinutesOfDay: LOCAL_MINUTES, now: T0 },
        makeComplete('x'),
      ),
    ).rejects.toThrow(ProactiveConversationNotFoundError);
  });
});
