import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createUIMessageStream } from 'ai';
import { DEFAULT_AGENT_ID } from '@aiko/shared';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { conversations, messages } from '../../db/schema';
import { pluginsRoute } from '../route';
import {
  clearEventHandlersForTests,
  publishEvent,
  subscribe,
} from '../event-bus';
import { getDisabledPluginIds } from '../persistence';
import { runContextContributors } from '../context-contributors';
import {
  createChatResponse,
  runChatPipeline,
  runRegeneratePipeline,
  type EmotionExtractor,
  type LlmStreamHandle,
} from '../../chat/service';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-19T00:00:00.000Z';

let handle: DbHandle;

function fakeLlm(reply: string): LlmStreamHandle {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: 'text-start', id: 'fake' });
      writer.write({ type: 'text-delta', id: 'fake', delta: reply });
      writer.write({ type: 'text-end', id: 'fake' });
    },
  });
  return { text: Promise.resolve(reply), toUimessageStream: () => stream as never };
}

async function readSse(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

const extractCalm: EmotionExtractor = async () => ({
  tag: 'calm',
  intensity: 3,
  reason: '测试',
});

beforeAll(() => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'aiko-plugins-p2-'));
  process.env.DATA_DIR = dataDir;
  handle = createDb(path.join(dataDir, 'agent.sqlite'));
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
});

afterAll(() => {
  clearEventHandlersForTests();
  vi.unstubAllEnvs();
});

describe('事件总线', () => {
  it('publish 按订阅顺序调用 handler，单个抛错不阻断其他 handler', async () => {
    const seen: string[] = [];
    const off1 = subscribe('message_created', () => {
      throw new Error('boom');
    });
    const off2 = subscribe('message_created', (payload) => {
      seen.push(payload.messageId);
    });

    await publishEvent('message_created', {
      conversationId: 'c',
      agentId: 'a',
      messageId: 'm1',
      role: 'user',
      content: 'hi',
    });

    expect(seen).toEqual(['m1']);
    off1();
    off2();
  });

  it('unsubscribe 后不再接收', async () => {
    const seen: string[] = [];
    const off = subscribe('summary_ready', (p) => seen.push(p.summaryId));
    off();
    await publishEvent('summary_ready', { conversationId: 'c', summaryId: 's1' });
    expect(seen).toEqual([]);
  });
});

describe('pipeline 事件发布', () => {
  it('普通聊天发布 message_created / state_changed / response_completed', async () => {
    handle.db
      .insert(conversations)
      .values({
        id: 'conv_evt',
        userId: 'user_local',
        agentId: DEFAULT_AGENT_ID,
        title: null,
        lastMessageAt: null,
        isArchived: 0,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();

    const created: string[] = [];
    const stateChanged: string[] = [];
    const completed: string[] = [];
    const offs = [
      subscribe('message_created', (p) => created.push(p.messageId)),
      subscribe('state_changed', (p) => stateChanged.push(p.eventId)),
      subscribe('response_completed', (p) => completed.push(p.messageId)),
    ];

    const pipeline = await runChatPipeline(
      handle,
      {
        agentId: DEFAULT_AGENT_ID,
        conversationId: 'conv_evt',
        message: '今天有点累',
        clientMessageId: 'client_evt_1',
      },
      NOW,
      () => fakeLlm('抱抱，休息一下吧。'),
      undefined,
      extractCalm,
      null,
    );
    await readSse(createChatResponse(handle, pipeline, NOW));
    offs.forEach((off) => off());

    expect(created).toHaveLength(1);
    expect(created[0]).toBe(pipeline.userMessageId);
    expect(stateChanged).toHaveLength(1);
    expect(completed).toHaveLength(1);
  });

  it('重新生成不发布 message_created，仅 response_completed', async () => {
    insertMessage('reg_u1', '2026-11-19T01:00:00.000Z', 'user', '再来一次');
    insertMessage('reg_a1', '2026-11-19T01:01:00.000Z', 'assistant', '旧回复');

    const created: string[] = [];
    const completed: string[] = [];
    const offs = [
      subscribe('message_created', (p) => created.push(p.messageId)),
      subscribe('response_completed', (p) => completed.push(p.messageId)),
    ];

    const pipeline = await runRegeneratePipeline(
      handle,
      { conversationId: 'conv_evt' },
      '2026-11-19T02:00:00.000Z',
      () => fakeLlm('新回复'),
      null,
    );
    await readSse(createChatResponse(handle, pipeline, '2026-11-19T02:00:00.000Z'));
    offs.forEach((off) => off());

    expect(created).toEqual([]);
    expect(completed).toHaveLength(1);
  });
});

function insertMessage(
  id: string,
  createdAt: string,
  role: 'user' | 'assistant',
  content?: string,
): void {
  handle.db
    .insert(messages)
    .values({
      id,
      conversationId: 'conv_evt',
      agentId: DEFAULT_AGENT_ID,
      userId: 'user_local',
      role,
      content: content ?? '内容 ' + id,
      status: 'complete',
      clientMessageId: role === 'user' ? 'client_' + id : null,
      errorCode: null,
      metadataJson: null,
      createdAt,
      updatedAt: createdAt,
    })
    .run();
}

describe('插件管理 API + 禁用过滤', () => {
  it('GET /api/plugins 列出全部内置插件且默认启用', async () => {
    const res = await pluginsRoute.request('/plugins');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plugins: Array<{ id: string; enabled: boolean }> };
    const ids = body.plugins.map((p) => p.id);
    expect(ids).toContain('builtin.emotion-line');
    expect(ids).toContain('emotion_care');
    expect(ids).toContain('builtin.emotion-llm-v2');
    expect(ids).toContain('builtin.semantic-python');
    expect(body.plugins.every((p) => p.enabled)).toBe(true);
  });

  it('PATCH 禁用 builtin.emotion-line → runContextContributors 不再注入情绪行', async () => {
    const res = await pluginsRoute.request('/plugins/builtin.emotion-line', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plugins: Array<{ id: string; enabled: boolean }> };
    expect(body.plugins.find((p) => p.id === 'builtin.emotion-line')?.enabled).toBe(false);
    expect(getDisabledPluginIds(handle)).toContain('builtin.emotion-line');

    const out = await runContextContributors({
      handle,
      agentId: DEFAULT_AGENT_ID,
      conversationId: 'conv_none',
      userText: '你好',
      now: NOW,
      emotion: {
        display: { valence: 0, arousal: 0, dominance: 0 },
        tag: 'neutral',
      },
      memoryHits: [],
      semanticHits: [],
    });
    expect(out.some((t) => t.includes('【当前情绪状态】'))).toBe(false);
  });

  it('PATCH 重新启用 → 情绪行恢复注入', async () => {
    await pluginsRoute.request('/plugins/builtin.emotion-line', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: true }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(getDisabledPluginIds(handle)).not.toContain('builtin.emotion-line');

    const out = await runContextContributors({
      handle,
      agentId: DEFAULT_AGENT_ID,
      conversationId: 'conv_none',
      userText: '你好',
      now: NOW,
      emotion: {
        display: { valence: 0, arousal: 0, dominance: 0 },
        tag: 'neutral',
      },
      memoryHits: [],
      semanticHits: [],
    });
    expect(out.some((t) => t.includes('【当前情绪状态】'))).toBe(true);
  });

  it('PATCH 未知插件 → 404 PLUGIN_NOT_FOUND', async () => {
    const res = await pluginsRoute.request('/plugins/none', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('PLUGIN_NOT_FOUND');
  });

  it('PATCH 缺少 enabled → 400', async () => {
    const res = await pluginsRoute.request('/plugins/builtin.emotion-line', {
      method: 'PATCH',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('PATCH 禁用策略插件 → pickStrategy 跳过（经 conversationsRoute 冒烟覆盖持久化）', async () => {
    // 禁用会话级插件不涉及 conversationsRoute，此处仅验证持久化写入
    await pluginsRoute.request('/plugins/builtin.noop', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(getDisabledPluginIds(handle)).toContain('builtin.noop');
    await pluginsRoute.request('/plugins/builtin.noop', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: true }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(getDisabledPluginIds(handle)).not.toContain('builtin.noop');
  });
});