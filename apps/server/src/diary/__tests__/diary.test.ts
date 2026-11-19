import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@aiko/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { conversations, diaryEntries, messages, stateEvents } from '../../db/schema';
import { diaryRoute } from '../route';
import {
  DiaryNotFoundError,
  deleteDiaryEntry,
  ensureDiaryForDate,
  ensureYesterdayDiary,
  listDiaryEntries,
  type DiaryCompleteFn,
} from '../service';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const YESTERDAY = '2026-11-18';
const NOW = '2026-11-19T10:00:00.000Z';

let handle: DbHandle;

function insertMessage(id: string, createdAt: string, role: 'user' | 'assistant', content: string): void {
  handle.db.insert(messages).values({
    id,
    conversationId: 'conv_diary',
    agentId: DEFAULT_AGENT_ID,
    userId: LOCAL_USER_ID,
    role,
    content,
    status: 'complete',
    clientMessageId: role === 'user' ? 'client_' + id : null,
    errorCode: null,
    metadataJson: null,
    createdAt,
    updatedAt: createdAt,
  }).run();
}

function diaryComplete(reply: string): DiaryCompleteFn {
  return async () => reply;
}

beforeAll(() => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'aiko-diary-'));
  process.env.DATA_DIR = dataDir;
  handle = createDb(path.join(dataDir, 'agent.sqlite'));
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
  handle.db.insert(conversations).values({
    id: 'conv_diary',
    userId: LOCAL_USER_ID,
    agentId: DEFAULT_AGENT_ID,
    title: null,
    lastMessageAt: null,
    isArchived: 0,
    createdAt: YESTERDAY + 'T08:00:00.000Z',
    updatedAt: NOW,
  }).run();
  // 昨天的消息 + 情绪事件（供快照）
  insertMessage('d_u1', YESTERDAY + 'T09:00:00.000Z', 'user', '今天学了做红烧肉');
  insertMessage('d_a1', YESTERDAY + 'T09:01:00.000Z', 'assistant', '听起来很棒！');
  handle.db.insert(stateEvents).values({
    id: 'state_d1',
    agentId: DEFAULT_AGENT_ID,
    conversationId: 'conv_diary',
    triggerMessageId: 'd_u1',
    source: 'user_message',
    ruleVersion: 'emotion-llm-v2',
    beforeValence: 0,
    beforeArousal: 0,
    beforeDominance: 0,
    deltaValence: 0.4,
    deltaArousal: 0.2,
    deltaDominance: 0,
    afterValence: 0.4,
    afterArousal: 0.2,
    afterDominance: 0,
    discreteTag: 'happy',
    reason: '聊到做饭很开心',
    evidenceText: '学做红烧肉',
    confidence: 0.9,
    createdAt: YESTERDAY + 'T09:00:30.000Z',
  }).run();
});

describe('ensureDiaryForDate（惰性生成）', () => {
  it('为昨天生成日记：第一人称内容 + 情绪快照落库', async () => {
    const result = await ensureDiaryForDate(
      handle,
      DEFAULT_AGENT_ID,
      YESTERDAY,
      NOW,
      { complete: diaryComplete('昨天我们聊了红烧肉，我很好奇味道。') },
    );
    expect(result.created).toBe(true);
    expect(result.diaryId).not.toBeNull();

    const row = handle.db
      .select()
      .from(diaryEntries)
      .where(eq(diaryEntries.id, result.diaryId!))
      .get()!;
    expect(row.type).toBe('daily');
    expect(row.date).toBe(YESTERDAY);
    expect(row.content).toContain('红烧肉');
    expect(row.moodValence).toBeCloseTo(0.4, 5);
    expect(row.moodArousal).toBeCloseTo(0.2, 5);
    expect(row.source).toBe('auto');
  });

  it('幂等：已有日记不再生成', async () => {
    const result = await ensureDiaryForDate(
      handle,
      DEFAULT_AGENT_ID,
      YESTERDAY,
      NOW,
      { complete: diaryComplete('不该被调用') },
    );
    expect(result.created).toBe(false);
    expect(result.reason).toBe('already-exists');
  });

  it('昨天没有消息 → 跳过（no-messages），不调 LLM', async () => {
    const llmCalled: string[] = [];
    const result = await ensureDiaryForDate(handle, DEFAULT_AGENT_ID, '2026-11-10', NOW, {
      complete: async () => {
        llmCalled.push('called');
        return 'x';
      },
    });
    expect(result.reason).toBe('no-messages');
    expect(llmCalled).toHaveLength(0);
  });

  it('LLM 失败 → 静默 llm-failed，不落库（下次 bootstrap 重试）', async () => {
    insertMessage('llm_u1', '2026-11-16T09:00:00.000Z', 'user', '随便聊聊');
    const result = await ensureDiaryForDate(handle, DEFAULT_AGENT_ID, '2026-11-16', NOW, {
      complete: async () => {
        throw new Error('no key');
      },
    });
    expect(result.created).toBe(false);
    expect(result.reason).toBe('llm-failed');
    expect(handle.db.select().from(diaryEntries).all().some((r) => r.date === '2026-11-17')).toBe(false);
  });

  it('ensureYesterdayDiary 以 now 为基准取昨天', async () => {
    // 今天（11-19）已有消息（NOW 在今天）→ 生成今天的？不——ensureYesterday 取昨天 11-18，已存在
    const result = await ensureYesterdayDiary(handle, DEFAULT_AGENT_ID, NOW, {
      complete: diaryComplete('x'),
    });
    expect(result.reason).toBe('already-exists');
  });
});

describe('listDiaryEntries / deleteDiaryEntry（服务层）', () => {
  it('按日期倒序列表 + type 过滤', () => {
    const all = listDiaryEntries(handle);
    expect(all.total).toBeGreaterThanOrEqual(1);
    const daily = listDiaryEntries(handle, { type: 'daily' });
    expect(daily.items.every((d) => d.type === 'daily')).toBe(true);
    expect(daily.items[0]?.mood).not.toBeNull();
  });

  it('删除 + 不存在 404 语义', () => {
    const created = listDiaryEntries(handle).items[0]!;
    expect(deleteDiaryEntry(handle, created.id).ok).toBe(true);
    expect(() => deleteDiaryEntry(handle, created.id)).toThrow(DiaryNotFoundError);
  });
});

describe('路由：GET / DELETE /api/diary', () => {
  it('GET 列表 200', async () => {
    const res = await diaryRoute.request('/diary?type=daily');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ type: string }>; total: number };
    expect(body.total).toBeGreaterThanOrEqual(0);
    expect(body.items.every((d) => d.type === 'daily')).toBe(true);
  });

  it('DELETE 不存在 → 404 DIARY_NOT_FOUND', async () => {
    const res = await diaryRoute.request('/diary/diary_none', { method: 'DELETE' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('DIARY_NOT_FOUND');
  });
});