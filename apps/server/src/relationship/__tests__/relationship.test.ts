import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@aiko/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { conversations, messages, stateEvents } from '../../db/schema';
import { bootstrapAgent } from '../../bootstrap/service';
import { pickStrategy } from '../../proactive/strategy';
import {
  computeRelationshipState,
  getRelationshipStateResponse,
} from '../service';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-19T00:00:00.000Z';

let handle: DbHandle;

function insertMessage(
  id: string,
  createdAt: string,
  role: 'user' | 'assistant' = 'user',
  content?: string,
): void {
  handle.db.insert(messages).values({
    id,
    conversationId: 'conv_rel',
    agentId: DEFAULT_AGENT_ID,
    userId: LOCAL_USER_ID,
    role,
    content: content ?? "消息 " + id,
    status: 'complete',
    clientMessageId: 'client_' + id,
    errorCode: null,
    metadataJson: null,
    createdAt,
    updatedAt: createdAt,
  }).run();
}

function insertNegativeStateEvent(createdAt: string): void {
  handle.db.insert(stateEvents).values({
    id: 'state_neg_' + createdAt,
    agentId: DEFAULT_AGENT_ID,
    conversationId: 'conv_rel',
    triggerMessageId: null,
    source: 'manual',
    ruleVersion: 'test',
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
    reason: '测试负面事件',
    evidenceText: '测试',
    confidence: 1,
    createdAt,
  }).run();
}

beforeAll(() => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'aiko-rel-'));
  process.env.DATA_DIR = dataDir;
  handle = createDb(path.join(dataDir, 'agent.sqlite'));
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
  handle.db.insert(conversations).values({
    id: 'conv_rel',
    userId: LOCAL_USER_ID,
    agentId: DEFAULT_AGENT_ID,
    title: null,
    lastMessageAt: null,
    isArchived: 0,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();
});

describe('computeRelationshipState（阶段阈值）', () => {
  it('无消息 → stranger（初识第 1 天）', () => {
    const rel = computeRelationshipState(handle, DEFAULT_AGENT_ID, NOW);
    expect(rel.firstMetAt).toBeNull();
    expect(rel.stage).toBe('stranger');
    expect(rel.daysKnown).toBe(0);
  });

  it('20 轮但不足 3 天 → stranger（双条件缺一不可）', () => {
    // 同一天插入 20 条 user 消息
    for (let i = 1; i <= 20; i++) {
      insertMessage('rel_u' + i, NOW.slice(0, 11) + String(8 + (i % 10)).padStart(2, '0') + ':' + String(i).padStart(2, '0') + ':00.000Z');
    }
    const rel = computeRelationshipState(handle, DEFAULT_AGENT_ID, NOW);
    expect(rel.totalTurns).toBe(20);
    expect(rel.stage).toBe('stranger');
  });

  it('满 3 天 + 满 20 轮 → familiar', () => {
    // 把首条消息改到 4 天前
    handle.db.update(messages)
      .set({ createdAt: '2026-11-15T08:00:00.000Z', updatedAt: '2026-11-15T08:00:00.000Z' })
      .where(eq(messages.id, 'rel_u1'))
      .run();
    const rel = computeRelationshipState(handle, DEFAULT_AGENT_ID, NOW);
    expect(rel.daysKnown).toBeGreaterThanOrEqual(3);
    expect(rel.stage).toBe('familiar');
  });

  it('getRelationshipStateResponse 契约形态', () => {
    const res = getRelationshipStateResponse(handle, DEFAULT_AGENT_ID, NOW);
    expect(res.ok).toBe(true);
    expect(res.relationship.stage).toBe('familiar');
    expect(typeof res.relationship.stageLabel).toBe('string');
    expect(typeof res.relationship.totalTurns).toBe('number');
  });
});

describe('主动策略阶段门控', () => {
  it('stranger 阶段：emotion_care / memory_recall 被门控跳过', () => {
    // 负面情绪已沉淀 >24h（emotion_care 本应命中）
    insertNegativeStateEvent('2026-11-17T00:00:00.000Z');
    const pick = pickStrategy(handle, DEFAULT_AGENT_ID, 'conv_rel', Date.parse(NOW));
    if (pick) {
      expect(pick.strategy).not.toBe('emotion_care');
      expect(pick.strategy).not.toBe('memory_recall');
    }
  });
});

describe('bootstrap 初见问候', () => {
  it('空会话时插入一条自我介绍（幂等）', async () => {
    const fresh = mkdtempSync(path.join(tmpdir(), 'aiko-rel-fresh-'));
    const freshHandle = createDb(path.join(fresh, 'agent.sqlite'));
    const freshMigrations = path.resolve(import.meta.dirname, '../../../drizzle');
    runMigrations(freshHandle, freshMigrations);
    seedDefaultData(freshHandle, NOW);
    runMigrations(freshHandle, freshMigrations);
    seedDefaultData(freshHandle, NOW);

    const response = bootstrapAgent(freshHandle, 'default', NOW);
    expect(response.messages).toHaveLength(1);
    expect(response.messages[0]!.role).toBe('assistant');
    expect(response.messages[0]!.content).toContain('我是 Aiko');

    // 幂等：再次 bootstrap 不重复问候
    const response2 = bootstrapAgent(freshHandle, 'default', '2026-11-19T01:00:00.000Z');
    expect(response2.messages).toHaveLength(1);
  });
});
// ---------------------------------------------------------------------------
// 维度引擎与自省（多元关系）
// ---------------------------------------------------------------------------
import { applyEventEffects, getDimensionState } from '../dimensions';
import { maybeEvaluateRelationship } from '../classify';

describe('applyEventEffects（规则引擎）', () => {
  it('conflict 抬升紧张/心结、压低信任；apology 反向修复', () => {
    const before = getDimensionState(handle, DEFAULT_AGENT_ID);
    const afterConflict = applyEventEffects(handle, DEFAULT_AGENT_ID, ['conflict'], NOW);
    expect(afterConflict.tension).toBeGreaterThan(before.tension);
    expect(afterConflict.grudge).toBeGreaterThan(before.grudge);
    expect(afterConflict.trust).toBeLessThan(before.trust);

    const afterApology = applyEventEffects(handle, DEFAULT_AGENT_ID, ['apology'], NOW);
    expect(afterApology.tension).toBeLessThan(afterConflict.tension);
    expect(afterApology.grudge).toBeLessThan(afterConflict.grudge);
    expect(afterApology.reason).toContain('道歉');
  });

  it('单日变化上限：同事件重复应用被截断', () => {
    const s1 = applyEventEffects(handle, DEFAULT_AGENT_ID, ['fun_interaction'], NOW);
    const s2 = applyEventEffects(handle, DEFAULT_AGENT_ID, ['fun_interaction'], NOW);
    // 第二次后 fun 相对 s1 的变化应小于单次全量 0.1（被日上限截断）
    expect(s2.fun - s1.fun).toBeLessThan(0.1);
    expect(s2.fun - s1.fun).toBeGreaterThanOrEqual(0);
  });
});

describe('maybeEvaluateRelationship（自省触发）', () => {
  it('累计 ≥10 条新用户消息 → 分类事件并写入印象与节流计数', async () => {
    // 插入 10 条用户消息（昨天起，保证轮数足够）
    for (let i = 1; i <= 10; i++) {
      insertMessage('ev_u' + i, '2026-11-18T0' + (i % 10) + ':30:00.000Z', 'user', '聊天内容' + i);
    }
    const calls: Array<{ system: string; prompt: string }> = [];
    const result = await maybeEvaluateRelationship(
      handle,
      DEFAULT_AGENT_ID,
      'conv_rel',
      NOW,
      async (input) => {
        calls.push(input);
        return '{"events":["deep_share","fun_interaction"],"impression":"TA 最近在认真学做菜，挺可爱的"}';
      },
    );
    expect(result.ran).toBe(true);
    expect(result.events).toEqual(['deep_share', 'fun_interaction']);

    const dims = getDimensionState(handle, DEFAULT_AGENT_ID);
    expect(dims.trust).toBeGreaterThan(0.2);
    expect(dims.fun).toBeGreaterThan(0.2);
    expect(dims.impression).toContain('学做菜');
    // 节流计数 = 自省时刻的全部累计轮数（20 rel + 10 ev）
    expect(dims.evalMessageCount).toBe(30);
    expect(calls[0]!.prompt).toContain('最近的对话');
  });

  it('LLM 失败 → 保持原状态（ran=false）', async () => {
    const before = getDimensionState(handle, DEFAULT_AGENT_ID);
    // 再插入 10 条消息触发阈值
    for (let i = 11; i <= 20; i++) {
      insertMessage('ev_u' + i, '2026-11-18T1' + (i % 10) + ':30:00.000Z', 'user', '更多聊天' + i);
    }
    const result = await maybeEvaluateRelationship(
      handle,
      DEFAULT_AGENT_ID,
      'conv_rel',
      NOW,
      async () => { throw new Error('no key'); },
    );
    expect(result.ran).toBe(false);
    expect(getDimensionState(handle, DEFAULT_AGENT_ID)).toEqual(before);
  });
});