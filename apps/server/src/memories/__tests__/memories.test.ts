import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_ID,
  LOCAL_USER_ID,
  type MemoryFactDTO,
} from '@aiko/shared';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import {
  confirmMemory,
  createMemory,
  deleteMemory,
  InvalidMemoryTransitionErrorFn,
  patchMemory,
  rejectMemory,
  restoreMemory,
} from './helpers';
import { memoriesRoute } from '../route';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-13T00:00:00.000Z';
const OWNER = { userId: LOCAL_USER_ID, agentId: DEFAULT_AGENT_ID };
const PAD = { v: -0.2, a: 0.3, d: 0 };

let handle: DbHandle;
let memoryId: string;

beforeAll(() => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'aiko-mem-route-'));
  process.env.DATA_DIR = dataDir;
  handle = createDb(path.join(dataDir, 'agent.sqlite'));
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);

  handle.sqlite
    .prepare(
      `INSERT INTO conversations
         (id, user_id, agent_id, is_archived, created_at, updated_at)
       VALUES ('conv_1', '${OWNER.userId}', '${OWNER.agentId}', 0, '${NOW}', '${NOW}')`,
    )
    .run();
  handle.sqlite
    .prepare(
      `INSERT INTO messages
         (id, conversation_id, agent_id, user_id, role, content, status,
          client_message_id, created_at, updated_at)
       VALUES ('msg_1', 'conv_1', '${OWNER.agentId}', '${OWNER.userId}',
               'user', '我在学做饭', 'complete', 'client_1', '${NOW}', '${NOW}')`,
    )
    .run();
});

describe('memories service: clear all (F18)', () => {
  it('clears every memory for the owner and empties FTS index', async () => {
    create();
    create({ content: '用户在学川菜' });

    const before = await memoriesRoute.request('/memories?limit=100');
    const beforeBody = (await before.json()) as { memories: { id: string }[] };
    expect(beforeBody.memories.length).toBeGreaterThan(0);

    const res = await memoriesRoute.request('/memories', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; clearedAt: string; count: number };
    expect(body.ok).toBe(true);
    expect(body.count).toBe(beforeBody.memories.length);
    expect(typeof body.clearedAt).toBe('string');

    const after = await memoriesRoute.request('/memories');
    const afterBody = (await after.json()) as { memories: unknown[] };
    expect(afterBody.memories).toEqual([]);

    const fts = handle.sqlite
      .prepare('SELECT COUNT(*) AS n FROM memories_fts')
      .get() as { n: number };
    expect(fts.n).toBe(0);
  });

  it('is idempotent on an empty store (count = 0)', async () => {
    const res = await memoriesRoute.request('/memories', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; clearedAt: string; count: number };
    expect(body.ok).toBe(true);
    expect(body.count).toBe(0);
  });
});

describe('memories list: total, q filter, source fields', () => {
  it('returns total, joins source message and filters by q', async () => {
    create({ content: '用户在学川菜' });
    create({ content: '用户喜欢跑步' });

    const all = await memoriesRoute.request('/memories?limit=10');
    const allBody = (await all.json()) as { memories: MemoryFactDTO[]; total: number };
    expect(allBody.total).toBe(allBody.memories.length);
    expect(allBody.total).toBeGreaterThan(1);
    const first = allBody.memories[0];
    expect(first?.sourceContent).toBe('我在学做饭');
    expect(first?.sourceConversationId).toBe('conv_1');

    const filtered = await memoriesRoute.request(
      '/memories?q=' + encodeURIComponent('川菜'),
    );
    const filteredBody = (await filtered.json()) as {
      memories: MemoryFactDTO[];
      total: number;
    };
    expect(filteredBody.total).toBe(1);
    expect(filteredBody.memories[0]?.content).toBe('用户在学川菜');
  });

  it('escapes LIKE wildcards in q', async () => {
    create({ content: '100% 确定' });
    const res = await memoriesRoute.request('/memories?q=%25');
    const body = (await res.json()) as { memories: MemoryFactDTO[]; total: number };
    expect(body.total).toBe(1);
    expect(body.memories[0]?.content).toBe('100% 确定');

    // 清理：恢复空库状态，避免 (source_message_id, content) 唯一约束影响后续用例
    await memoriesRoute.request('/memories', { method: 'DELETE' });
  });
});

function create(overrides: Record<string, unknown> = {}) {
  return createMemory(handle, {
    owner: OWNER,
    type: 'fact',
    content: '用户正在学做饭',
    sourceMessageId: 'msg_1',
    confidence: 0.9,
    memoryPad: PAD,
    arousal: 0.3,
    halfLifeHours: 93.6,
    now: NOW,
    ...overrides,
  });
}

describe('memories service: create + conflict (F15/F16)', () => {
  it('high confidence becomes active; low confidence becomes candidate', () => {
    const high = create();
    memoryId = high.memory.id;
    expect(high.memory.status).toBe('active');
    expect(high.outdatedIds).toEqual([]);

    const low = create({ content: '用户可能住在上海', confidence: 0.4 });
    expect(low.memory.status).toBe('candidate');
  });

  it('same-type active conflict is auto-outdated for low-risk types', async () => {
    const second = create({ content: '用户搬到杭州学杭帮菜' });
    expect(second.memory.status).toBe('active');
    expect(second.outdatedIds).toContain(memoryId);

    const res = await memoriesRoute.request('/memories?status=active');
    const body = (await res.json()) as { memories: MemoryFactDTO[] };
    const contents = body.memories.map((m) => m.content);
    expect(contents).toContain('用户搬到杭州学杭帮菜');
    expect(contents).not.toContain('用户正在学做饭');
  });

  it('prevents duplicate extraction from the same message', () => {
    expect(() =>
      create({ sourceMessageId: 'msg_1', content: '用户搬到杭州学杭帮菜' }),
    ).toThrow();
  });
});

describe('memories service: status transitions', () => {
  it('confirm / reject only apply to candidate; restore applies to outdated', () => {
    const cand = create({ content: '用户下周有考试', confidence: 0.3 }).memory;
    const confirmed = confirmMemory(handle, OWNER, cand.id);
    expect(confirmed.status).toBe('active');
    expect(() => confirmMemory(handle, OWNER, cand.id)).not.toThrow(); // 幂等

    const rej = create({ content: '用户讨厌香菜', confidence: 0.2 }).memory;
    expect(rejectMemory(handle, OWNER, rej.id).status).toBe('rejected');
    expect(() => confirmMemory(handle, OWNER, rej.id)).toThrow(
      InvalidMemoryTransitionErrorFn,
    );

    // active -> outdated（模拟新事实替代）后可恢复
    const restored = restoreMemory(handle, OWNER, memoryId);
    expect(restored.status).toBe('active');
  });

  it('deleted memories are soft-deleted and cannot transition further', () => {
    const doomed = create({ content: '用户喜欢蓝色' }).memory;
    const deleted = deleteMemory(handle, OWNER, doomed.id);
    expect(deleted.status).toBe('deleted');
    expect(() => confirmMemory(handle, OWNER, doomed.id)).toThrow(
      InvalidMemoryTransitionErrorFn,
    );
    expect(deleteMemory(handle, OWNER, doomed.id).status).toBe('deleted'); // 幂等
  });

  it('patch updates content/type but not on deleted memories', () => {
    const editable = create({ content: '用户在学粤菜' }).memory;
    const patched = patchMemory(handle, OWNER, editable.id, {
      content: '用户在学川菜',
      type: 'goal',
    });
    expect(patched.content).toBe('用户在学川菜');
    expect(patched.type).toBe('goal');

    const dead = create({ content: '用户喜欢红色' }).memory;
    deleteMemory(handle, OWNER, dead.id);
    expect(() => patchMemory(handle, OWNER, dead.id, { content: 'x' })).toThrow(
      InvalidMemoryTransitionErrorFn,
    );
  });
});

describe('memories routes (api-contract §6.5)', () => {
  it('GET lists memories with owner scoping and status filter', async () => {
    const res = await memoriesRoute.request('/memories?status=candidate');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { memories: MemoryFactDTO[] };
    expect(body.memories.every((m) => m.status === 'candidate')).toBe(true);
  });

  it('GET validates query params', async () => {
    const res = await memoriesRoute.request('/memories?status=bogus');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_REQUEST');
  });

  it('PATCH requires a non-empty body', async () => {
    const res = await memoriesRoute.request('/memories/whatever', {
      method: 'PATCH',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('PATCH / DELETE / confirm return 404 for unknown ids', async () => {
    const patch = await memoriesRoute.request('/memories/mem_none', {
      method: 'PATCH',
      body: JSON.stringify({ content: 'x' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const del = await memoriesRoute.request('/memories/mem_none', { method: 'DELETE' });
    const confirm = await memoriesRoute.request('/memories/mem_none/reject', { method: 'POST' });
    expect(patch.status).toBe(404);
    expect(del.status).toBe(404);
    expect(confirm.status).toBe(404);
    for (const res of [patch, del, confirm]) {
      expect(((await res.json()) as { code: string }).code).toBe('MEM_NOT_FOUND');
    }
  });

  it('confirm endpoint works end-to-end', async () => {
    const cand = create({ content: '用户有一个朋友叫小明', confidence: 0.4 }).memory;
    const res = await memoriesRoute.request(`/memories/${cand.id}/confirm`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as MemoryFactDTO).status).toBe('active');
  });

  it('delete endpoint soft-deletes end-to-end', async () => {
    const res = await memoriesRoute.request(`/memories/${memoryId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as MemoryFactDTO).status).toBe('deleted');
  });
});
