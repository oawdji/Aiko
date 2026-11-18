import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@aiko/shared';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { conversations, conversationSummaries, messages } from '../../db/schema';
import {
  buildSummaryPromptLine,
  getRecentWindowOldestCreatedAt,
  loadInjectableSummaries,
} from '../summary-context';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');

let handle: DbHandle;
const T0 = '2026-11-12T00:00:00.000Z';

function insertMessage(
  id: string,
  createdAt: string,
  opts: {
    role?: 'user' | 'assistant';
    status?: 'complete' | 'failed';
    conversationId?: string;
  } = {},
): void {
  handle.db
    .insert(messages)
    .values({
      id,
      conversationId: opts.conversationId ?? 'conv_sum',
      agentId: DEFAULT_AGENT_ID,
      userId: LOCAL_USER_ID,
      role: opts.role ?? 'user',
      content: '内容 ' + id,
      status: opts.status ?? 'complete',
      clientMessageId: (opts.role ?? 'user') === 'user' ? 'client_' + id : null,
      errorCode: opts.status === 'failed' ? 'LLM_REQUEST_FAILED' : null,
      metadataJson: null,
      createdAt,
      updatedAt: createdAt,
    })
    .run();
}

function insertSummary(
  id: string,
  content: string,
  startMessageId: string,
  endMessageId: string,
  status: 'ready' | 'pending' | 'failed' | 'deleted',
  createdAt: string,
  convId: string = 'conv_sum',
): void {
  handle.db
    .insert(conversationSummaries)
    .values({
      id,
      conversationId: convId,
      agentId: DEFAULT_AGENT_ID,
      startMessageId,
      endMessageId,
      content,
      status,
      createdAt,
      updatedAt: createdAt,
    })
    .run();
}

beforeAll(() => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'aiko-summary-ctx-')), 'agent.sqlite');
  handle = createDb(dbPath);
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, T0);
  handle.db
    .insert(conversations)
    .values({
      id: 'conv_sum',
      userId: LOCAL_USER_ID,
      agentId: DEFAULT_AGENT_ID,
      title: null,
      lastMessageAt: null,
      isArchived: 0,
      createdAt: T0,
      updatedAt: T0,
    })
    .run();

  // 早期消息（摘要范围，已滑出窗口）
  insertMessage('msg_user_s1', '2026-11-12T00:01:00.000Z');
  insertMessage('msg_asst_s1', '2026-11-12T00:02:00.000Z', { role: 'assistant' });
  insertMessage('msg_user_s2', '2026-11-12T00:03:00.000Z');
  insertMessage('msg_asst_s2', '2026-11-12T00:04:00.000Z', { role: 'assistant' });
  // 窗口内消息（最近 30 条之内）
  insertMessage('msg_user_w1', '2026-11-12T10:00:00.000Z');
  insertMessage('msg_asst_w1', '2026-11-12T10:01:00.000Z', { role: 'assistant' });

  // ① 早期摘要（end 在窗口最旧消息之前）→ 应注入
  insertSummary('sum_1', '用户在学做饭，喜欢清淡口味。', 'msg_user_s1', 'msg_asst_s1', 'ready', '2026-11-12T00:10:00.000Z');
  // ② 更晚的早期摘要 → 应注入（时间正序）
  insertSummary('sum_2', '用户提到最近工作压力大。\n换行应该被折叠。', 'msg_user_s2', 'msg_asst_s2', 'ready', '2026-11-12T00:20:00.000Z');
  // ③ end 在窗口内 → 应排除（避免与窗口重复）
  insertSummary('sum_3', '这份摘要覆盖当前窗口，不应注入。', 'msg_user_w1', 'msg_asst_w1', 'ready', '2026-11-12T10:10:00.000Z');
  // ④ 非 ready 状态 → 应排除
  insertSummary('sum_4', 'pending 摘要不应注入。', 'msg_user_s1', 'msg_asst_s1', 'pending', '2026-11-12T00:30:00.000Z');
  insertSummary('sum_5', 'failed 摘要不应注入。', 'msg_user_s2', 'msg_asst_s2', 'failed', '2026-11-12T00:31:00.000Z');
});

describe('loadInjectableSummaries', () => {
  it('only returns ready summaries fully outside the recent window, in ascending order', () => {
    const summaries = loadInjectableSummaries(handle, 'conv_sum', '2026-11-12T09:00:00.000Z');
    expect(summaries).toEqual([
      '用户在学做饭，喜欢清淡口味。',
      '用户提到最近工作压力大。\n换行应该被折叠。',
    ]);
  });

  it('excludes summaries whose end message equals the window boundary (same timestamp)', () => {
    // 窗口最旧消息与 sum_3 的 end 同毫秒 → 跳过（安全侧）
    const summaries = loadInjectableSummaries(handle, 'conv_sum', '2026-11-12T10:01:00.000Z');
    expect(summaries).not.toContain('这份摘要覆盖当前窗口，不应注入。');
    expect(summaries).not.toContain('pending 摘要不应注入。');
    expect(summaries).not.toContain('failed 摘要不应注入。');
    expect(summaries).toContain('用户在学做饭，喜欢清淡口味。');
  });

  it('returns all ready summaries when window is empty (null boundary)', () => {
    const summaries = loadInjectableSummaries(handle, 'conv_sum', null);
    expect(summaries).toHaveLength(3);
  });

  it('returns empty for unknown conversation', () => {
    expect(loadInjectableSummaries(handle, 'conv_none', null)).toEqual([]);
  });
});

describe('getRecentWindowOldestCreatedAt', () => {
  it('returns the oldest createdAt among the last N complete messages', () => {
    // conv_sum 只有 4 条 complete（含早期），窗口 limit 30 → 最旧是 msg_user_s1
    expect(getRecentWindowOldestCreatedAt(handle, 'conv_sum', 30)).toBe(
      '2026-11-12T00:01:00.000Z',
    );
    // limit 2 → 只看最后两条（10:00 / 10:01），最旧 10:00
    expect(getRecentWindowOldestCreatedAt(handle, 'conv_sum', 2)).toBe(
      '2026-11-12T10:00:00.000Z',
    );
  });

  it('returns null for empty conversation', () => {
    expect(getRecentWindowOldestCreatedAt(handle, 'conv_none', 30)).toBeNull();
  });
});

describe('buildSummaryPromptLine', () => {
  it('returns null when there are no summaries', () => {
    expect(buildSummaryPromptLine([])).toBeNull();
  });

  it('formats summaries as a single block with newlines flattened', () => {
    const line = buildSummaryPromptLine(['用户在学做饭。', '用户工作压力大。\n最近很忙']);
    expect(line).toBe(
      '[早期对话回顾]\n' +
        '- 用户在学做饭。\n' +
        '- 用户工作压力大。 最近很忙\n' +
        '(以上是更早对话的阶段性摘要，供延续语境使用，不要主动提及本列表)',
    );
  });
});// ---------------------------------------------------------------------------
// 集成：runChatPipeline 注入摘要到 system prompt
// ---------------------------------------------------------------------------
import { runChatPipeline, type EmotionExtractor } from '../service';

const extractNullPipe: EmotionExtractor = async () => null;

describe('runChatPipeline injects out-of-window summaries (分层记忆补全)', () => {
  it('system prompt contains out-of-window summary and excludes in-window summary', async () => {
    handle.db
      .insert(conversations)
      .values({
        id: 'conv_sum_pipe',
        userId: LOCAL_USER_ID,
        agentId: DEFAULT_AGENT_ID,
        title: null,
        lastMessageAt: null,
        isArchived: 0,
        createdAt: T0,
        updatedAt: T0,
      })
      .run();

    // 早期消息 + 摘要 A（end 远早于窗口）→ 应注入
    insertMessage('pipe_m01', '2026-11-12T00:01:00.000Z', { conversationId: 'conv_sum_pipe' });
    insertMessage('pipe_m02', '2026-11-12T00:02:00.000Z', { role: 'assistant', conversationId: 'conv_sum_pipe' });
    insertSummary(
      'pipe_sum_a',
      '用户喜欢清晨散步。',
      'pipe_m01',
      'pipe_m02',
      'ready',
      '2026-11-12T00:10:00.000Z',
      'conv_sum_pipe',
    );

    // 35 条近期消息 → 窗口（30 条）最旧 ≈ 10:06
    for (let i = 1; i <= 35; i++) {
      const minute = String(i).padStart(2, '0');
      const at = `2026-11-12T10:${minute}:00.000Z`;
      insertMessage(`pipe_w${String(i).padStart(2, '0')}`, at, {
        role: i % 2 === 1 ? 'user' : 'assistant',
        conversationId: 'conv_sum_pipe',
      });
    }
    // 摘要 B 覆盖窗口内消息（10:30/10:31）→ 不应注入
    insertMessage('pipe_b01', '2026-11-12T10:30:00.000Z', { conversationId: 'conv_sum_pipe' });
    insertMessage('pipe_b02', '2026-11-12T10:31:00.000Z', { role: 'assistant', conversationId: 'conv_sum_pipe' });
    insertSummary(
      'pipe_sum_b',
      '这份覆盖窗口内的摘要不应出现。',
      'pipe_b01',
      'pipe_b02',
      'ready',
      '2026-11-12T10:40:00.000Z',
      'conv_sum_pipe',
    );

    let capturedSystem = '';
    const pipeline = await runChatPipeline(
      handle,
      {
        agentId: DEFAULT_AGENT_ID,
        conversationId: 'conv_sum_pipe',
        message: '还记得我之前说过什么吗',
        clientMessageId: 'client_sum_pipe_1',
      },
      '2026-11-12T11:00:00.000Z',
      ({ system }) => {
        capturedSystem = system;
        return {
          text: Promise.resolve('记得呀'),
          toUimessageStream: () => {
            throw new Error('stream not used in this test');
          },
        };
      },
      undefined,
      extractNullPipe,
      null, // 不启用 Python 语义检索
    );

    expect(pipeline.userMessage).toBe('还记得我之前说过什么吗');
    expect(capturedSystem).toContain('[早期对话回顾]');
    expect(capturedSystem).toContain('用户喜欢清晨散步。');
    expect(capturedSystem).not.toContain('这份覆盖窗口内的摘要不应出现。');
  });
});
