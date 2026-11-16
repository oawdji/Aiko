import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@aiko/shared';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import type { CompleteFn } from '../../extraction/types';
import {
  computeStrength,
  CORE_STRENGTH_FLOOR,
  maybeTriggerSummary,
  reconsolidate,
  refreshStrengths,
  runSummaryTask,
  SUMMARY_MESSAGE_THRESHOLD,
} from '../lifecycle';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-13T00:00:00.000Z';
const OWNER = { userId: LOCAL_USER_ID, agentId: DEFAULT_AGENT_ID };

let handle: DbHandle;

function addMemory(
  id: string,
  opts: {
    ageHours?: number;
    halfLifeHours?: number;
    isCore?: boolean | 0 | 1;
    arousal?: number;
    status?: string;
  } = {},
): void {
  const createdAt = new Date(Date.parse(NOW) - (opts.ageHours ?? 0) * 3_600_000).toISOString();
  handle.sqlite
    .prepare(
      'INSERT OR IGNORE INTO memories (id, user_id, agent_id, type, content, source_message_id, confidence, status, memory_pad, arousal, half_life_hours, strength, is_core, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      OWNER.userId,
      OWNER.agentId,
      'fact',
      `事实${id}`,
      'msg_lc_src',
      0.9,
      opts.status ?? 'active',
      '{"v":0,"a":0,"d":0}',
      opts.arousal ?? 0,
      opts.halfLifeHours ?? 72,
      1,
      opts.isCore ? 1 : 0,
      createdAt,
      createdAt,
    );
}

beforeAll(() => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'aiko-lifecycle-')), 'agent.sqlite');
  handle = createDb(dbPath);
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);

  handle.sqlite
    .prepare(
      "INSERT OR IGNORE INTO conversations (id, user_id, agent_id, is_archived, created_at, updated_at) VALUES ('conv_lc', ?, ?, 0, ?, ?)",
    )
    .run(OWNER.userId, OWNER.agentId, NOW, NOW);
  const insertMsg = handle.sqlite.prepare(
    "INSERT OR IGNORE INTO messages (id, conversation_id, agent_id, user_id, role, content, status, client_message_id, created_at, updated_at) VALUES (?, 'conv_lc', ?, ?, 'user', 'x', 'complete', ?, ?, ?)",
  );
  insertMsg.run('msg_lc_src', DEFAULT_AGENT_ID, LOCAL_USER_ID, 'client_lc_src', NOW, NOW);
  for (let i = 0; i < SUMMARY_MESSAGE_THRESHOLD + 2; i++) {
    insertMsg.run(
      `msg_lc_${i}`,
      DEFAULT_AGENT_ID,
      LOCAL_USER_ID,
      `client_lc_${i}`,
      new Date(Date.parse(NOW) + i * 1000).toISOString(),
      new Date(Date.parse(NOW) + i * 1000).toISOString(),
    );
  }
});

describe('computeStrength (power-law forgetting)', () => {
  it('is 1 at creation and decays with a half-life knee', () => {
    const fresh = computeStrength({ createdAtIso: NOW, nowIso: NOW, halfLifeHours: 72 });
    expect(fresh).toBe(1);
    const atHalf = computeStrength({
      createdAtIso: new Date(Date.parse(NOW) - 72 * 3600_000).toISOString(),
      nowIso: NOW,
      halfLifeHours: 72,
    });
    expect(atHalf).toBeCloseTo(Math.pow(2, -0.5));
    expect(atHalf).toBeLessThan(fresh);
  });

  it('floors core memories', () => {
    const s = computeStrength({
      createdAtIso: new Date(Date.parse(NOW) - 8760 * 3600_000).toISOString(),
      nowIso: NOW,
      halfLifeHours: 72,
      isCore: true,
    });
    expect(s).toBe(CORE_STRENGTH_FLOOR);
  });
});

describe('reconsolidation', () => {
  it('boosts arousal with cap and preserves the base half life', () => {
    const r = reconsolidate(0.3, 93.6);
    expect(r.arousal).toBeCloseTo(0.35);
    // base = 93.6/1.3 = 72 保持不变
    expect(r.halfLifeHours).toBeCloseTo(72 * 1.35);
  });

  it('caps arousal at 0.95', () => {
    const r = reconsolidate(0.93, 72);
    expect(r.arousal).toBe(0.95);
  });
});

describe('refreshStrengths', () => {
  it('persists decayed strength for aged memories', () => {
    addMemory('mem_lc_fresh', { ageHours: 0 });
    addMemory('mem_lc_old', { ageHours: 720 });
    const updated = refreshStrengths(handle, OWNER, NOW);
    expect(updated).toBeGreaterThanOrEqual(1);
    const fresh = handle.sqlite.prepare('SELECT strength FROM memories WHERE id = ?').get('mem_lc_fresh') as { strength: number };
    const old = handle.sqlite.prepare('SELECT strength FROM memories WHERE id = ?').get('mem_lc_old') as { strength: number };
    expect(fresh.strength).toBe(1);
    expect(old.strength).toBeLessThan(fresh.strength);
    // 幂等：再次刷新不再变化
    expect(refreshStrengths(handle, OWNER, NOW)).toBe(0);
  });
});

describe('summary trigger (F14)', () => {
  it('triggers a pending task after threshold messages and is idempotent', () => {
    const first = maybeTriggerSummary(handle, 'conv_lc', DEFAULT_AGENT_ID, NOW);
    expect(first.triggered).toBe(true);
    expect(first.messageCount).toBe(SUMMARY_MESSAGE_THRESHOLD + 3);

    const row = handle.sqlite
      .prepare('SELECT * FROM conversation_summaries ORDER BY created_at DESC')
      .get() as Record<string, unknown>;
    expect(row.status).toBe('pending');
    expect(['msg_lc_src', 'msg_lc_0']).toContain(row.start_message_id);
    expect(row.end_message_id).toBe(`msg_lc_${SUMMARY_MESSAGE_THRESHOLD + 1}`);

    const second = maybeTriggerSummary(handle, 'conv_lc', DEFAULT_AGENT_ID, NOW);
    expect(second.triggered).toBe(false);
  });

  it('runSummaryTask fills content via LLM and marks ready; failures mark failed', async () => {
    const sum = handle.sqlite
      .prepare('SELECT id FROM conversation_summaries ORDER BY created_at DESC')
      .get() as { id: string };
    const good: CompleteFn = async () => '用户在学做饭，并聊了日常安排。';
    expect(await runSummaryTask(handle, sum.id, good, NOW)).toBe('ready');
    const ready = handle.sqlite
      .prepare('SELECT content, status FROM conversation_summaries WHERE id = ?')
      .get(sum.id) as { content: string; status: string };
    expect(ready.status).toBe('ready');
    expect(ready.content).toContain('学做饭');

    // 新建一个 pending 任务模拟 LLM 失败
    handle.sqlite
      .prepare(
        "INSERT INTO conversation_summaries (id, conversation_id, agent_id, start_message_id, end_message_id, content, status, created_at, updated_at) VALUES ('sum_fail', 'conv_lc', ?, 'msg_lc_0', 'msg_lc_1', '', 'pending', ?, ?)",
      )
      .run(DEFAULT_AGENT_ID, NOW, NOW);
    const bad: CompleteFn = async () => {
      throw new Error('llm down');
    };
    expect(await runSummaryTask(handle, 'sum_fail', bad, NOW)).toBe('failed');
    const failed = handle.sqlite
      .prepare('SELECT status FROM conversation_summaries WHERE id = ?')
      .get('sum_fail') as { status: string };
    expect(failed.status).toBe('failed');

    // failed 可重试
    expect(await runSummaryTask(handle, 'sum_fail', good, NOW)).toBe('ready');
  });
});
