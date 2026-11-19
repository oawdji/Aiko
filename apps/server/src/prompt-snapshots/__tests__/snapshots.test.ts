import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@aiko/shared';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { conversations, promptSnapshots } from '../../db/schema';
import { promptSnapshotsRoute } from '../route';
import { clearAllPromptSnapshots, listPromptSnapshots } from '../service';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-19T00:00:00.000Z';

let handle: DbHandle;

function insertSnapshot(id: string, createdAt: string, conversationId = 'conv_snap'): void {
  try {
    handle.db.insert(promptSnapshots).values({
      id,
      agentId: DEFAULT_AGENT_ID,
      conversationId,
      userMessageId: 'msg_' + id,
      systemText: 'system prompt of ' + id,
      memoryIdsJson: JSON.stringify(['mem_1', 'mem_2']),
      recentWindowCount: '12',
      personaVersion: 2,
      createdAt,
    }).run();
  } catch (e) {
    throw e;
  }
}

beforeAll(() => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'aiko-snapshots-'));
  process.env.DATA_DIR = dataDir;
  handle = createDb(path.join(dataDir, 'agent.sqlite'));
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
  try {
    handle.db.insert(conversations).values({
      id: 'conv_snap',
      userId: LOCAL_USER_ID,
      agentId: DEFAULT_AGENT_ID,
      title: null,
      lastMessageAt: null,
      isArchived: 0,
      createdAt: NOW,
      updatedAt: NOW,
    }).run();
  } catch (e) {
    throw e;
  }
  handle.db.insert(conversations).values({
    id: 'conv_other',
    userId: LOCAL_USER_ID,
    agentId: DEFAULT_AGENT_ID,
    title: null,
    lastMessageAt: null,
    isArchived: 0,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();

  insertSnapshot('snap_a', '2026-11-18T00:00:00.000Z');
  insertSnapshot('snap_b', '2026-11-18T01:00:00.000Z');
  insertSnapshot('snap_c', '2026-11-18T02:00:00.000Z', 'conv_other');
});

describe('listPromptSnapshots（服务层）', () => {
  it('按时间倒序返回全部', () => {
    const result = listPromptSnapshots(handle);
    expect(result.total).toBe(3);
    expect(result.items.map((s) => s.id)).toEqual(['snap_c', 'snap_b', 'snap_a']);
    const first = result.items[0]!;
    expect(first.memoryIds).toEqual(['mem_1', 'mem_2']);
    expect(first.recentWindowCount).toBe(12);
    expect(first.personaVersion).toBe(2);
  });

  it('conversationId 过滤 + 分页', () => {
    const result = listPromptSnapshots(handle, { conversationId: 'conv_snap', limit: 1, offset: 1 });
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe('snap_a');
  });

  it('损坏的 memoryIdsJson 降级为空数组', () => {
    handle.db.update(promptSnapshots).set({ memoryIdsJson: 'not-json' }).where(eq(promptSnapshots.id, 'snap_a')).run();
    const result = listPromptSnapshots(handle);
    expect(result.items.find((s) => s.id === 'snap_a')?.memoryIds).toEqual([]);
  });
});

describe('clearAllPromptSnapshots（服务层）', () => {
  it('清空全部并返回数量', () => {
    const result = clearAllPromptSnapshots(handle);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(3);
    expect(listPromptSnapshots(handle).total).toBe(0);
  });
});

describe('路由：GET / DELETE /api/prompt-snapshots', () => {
  it('GET 空列表 200', async () => {
    const res = await promptSnapshotsRoute.request('/prompt-snapshots');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(body.total).toBe(0);
  });

  it('GET limit 非法 → 400', async () => {
    const res = await promptSnapshotsRoute.request('/prompt-snapshots?limit=0');
    expect(res.status).toBe(400);
  });

  it('DELETE 清空返回计数', async () => {
    insertSnapshot('snap_d', NOW);
    const res = await promptSnapshotsRoute.request('/prompt-snapshots', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(1);
  });
});