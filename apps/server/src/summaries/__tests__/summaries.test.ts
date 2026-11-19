import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@aiko/shared';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { conversations, conversationSummaries, messages } from '../../db/schema';
import { conversationsRoute } from '../../conversations/route';
import { summariesRoute } from '../route';
import { SummaryNotFoundError, deleteSummary, listSummaries } from '../service';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-19T00:00:00.000Z';

let handle: DbHandle;

function insertSummary(
  id: string,
  content: string,
  status: 'ready' | 'pending' | 'failed' | 'deleted',
  createdAt: string,
): void {
  handle.db
    .insert(conversationSummaries)
    .values({
      id,
      conversationId: 'conv_sum',
      agentId: DEFAULT_AGENT_ID,
      startMessageId: 'm1',
      endMessageId: 'm2',
      content,
      status,
      createdAt,
      updatedAt: createdAt,
    })
    .run();
}

beforeAll(() => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'aiko-summaries-'));
  process.env.DATA_DIR = dataDir;
  handle = createDb(path.join(dataDir, 'agent.sqlite'));
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
  handle.db
    .insert(conversations)
    .values({
      id: 'conv_sum',
      userId: LOCAL_USER_ID,
      agentId: DEFAULT_AGENT_ID,
      title: null,
      lastMessageAt: null,
      isArchived: 0,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
  // 消息外键：summaries 引用 start/end 消息
  handle.db
    .insert(messages)
    .values([
      {
        id: 'm1',
        conversationId: 'conv_sum',
        agentId: DEFAULT_AGENT_ID,
        userId: LOCAL_USER_ID,
        role: 'user',
        content: 'a',
        status: 'complete',
        clientMessageId: 'c1',
        errorCode: null,
        metadataJson: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'm2',
        conversationId: 'conv_sum',
        agentId: DEFAULT_AGENT_ID,
        userId: LOCAL_USER_ID,
        role: 'assistant',
        content: 'b',
        status: 'complete',
        clientMessageId: null,
        errorCode: null,
        metadataJson: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ])
    .run();

  insertSummary('sum_1', '第一条摘要', 'ready', '2026-11-18T00:00:00.000Z');
  insertSummary('sum_2', '第二条摘要', 'ready', '2026-11-19T00:00:00.000Z');
  insertSummary('sum_p', 'pending 不可见', 'pending', NOW);
  insertSummary('sum_d', 'deleted 不可见', 'deleted', NOW);
});


describe('listSummaries（服务层）', () => {
  it('只返回 ready 摘要，按时间倒序', () => {
    const result = listSummaries(handle);
    expect(result.total).toBe(2);
    expect(result.items.map((s) => s.id)).toEqual(['sum_2', 'sum_1']);
  });

  it('支持 conversationId 过滤与分页', () => {
    const result = listSummaries(handle, { conversationId: 'conv_sum', limit: 1, offset: 1 });
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe('sum_1');
  });

  it('未知会话返回空', () => {
    expect(listSummaries(handle, { conversationId: 'conv_none' }).total).toBe(0);
  });
});

describe('deleteSummary（服务层）', () => {
  it('软删除 ready 摘要，且从列表消失', () => {
    const result = deleteSummary(handle, 'sum_1', NOW);
    expect(result.ok).toBe(true);
    expect(listSummaries(handle).items.some((s) => s.id === 'sum_1')).toBe(false);
  });

  it('重复删除 / 不存在 → SummaryNotFoundError', () => {
    expect(() => deleteSummary(handle, 'sum_1', NOW)).toThrow(SummaryNotFoundError);
    expect(() => deleteSummary(handle, 'sum_none', NOW)).toThrow(SummaryNotFoundError);
  });
});

describe('路由：GET/DELETE /api/summaries', () => {
  it('GET 返回 ready 列表', async () => {
    const res = await summariesRoute.request('/summaries');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.items[0]).toMatchObject({ conversationId: 'conv_sum' });
  });

  it('GET 校验 limit 非法 → 400', async () => {
    const res = await summariesRoute.request('/summaries?limit=0');
    expect(res.status).toBe(400);
  });

  it('DELETE 软删除成功', async () => {
    const res = await summariesRoute.request('/summaries/sum_2', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('DELETE 不存在 → 404 SUMMARY_NOT_FOUND', async () => {
    const res = await summariesRoute.request('/summaries/sum_none', { method: 'DELETE' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('SUMMARY_NOT_FOUND');
  });

  it('conversations delete 不受影响（回归冒烟）', async () => {
    const res = await conversationsRoute.request('/conversations');
    expect(res.status).toBe(200);
  });
});