import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createUIMessageStream } from 'ai';
import type { ChatRequestBody } from '@aiko/shared';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@aiko/shared';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { eq } from 'drizzle-orm';
import { agents, conversations } from '../../db/schema';
import {
  LlmRequestFailedError,
  createChatResponse,
  runChatPipeline,
  type EmotionExtractor,
  type LlmStreamHandle,
} from '../service';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-12T00:00:00.000Z';

let handle: DbHandle;

beforeAll(() => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'aiko-chat-pipeline-')), 'agent.sqlite');
  handle = createDb(dbPath);
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
  handle.db.insert(conversations).values({
    id: 'conv_pipe',
    userId: LOCAL_USER_ID,
    agentId: DEFAULT_AGENT_ID,
    title: null,
    lastMessageAt: null,
    isArchived: 0,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

const baseBody: ChatRequestBody = {
  agentId: DEFAULT_AGENT_ID,
  conversationId: 'conv_pipe',
  message: '今天好累',
  clientMessageId: 'client_pipe_1',
};

/** 抽取器 fake:始终返回 low|5(方案 1 独立抽取,不依赖回复标记)。 */
const extractLow5: EmotionExtractor = async () => ({ tag: 'low', intensity: 5, reason: '用户很疲惫' });

/** 抽取器 fake:始终返回 null(抽取失败降级)。 */
const extractNull: EmotionExtractor = async () => null;

function zeroAgentState(nowIso = NOW): void {
  handle.db.update(agents).set({
    currentValence: 0,
    currentArousal: 0,
    currentDominance: 0,
    currentTag: 'neutral',
    stateUpdatedAt: nowIso,
    updatedAt: nowIso,
  }).where(eq(agents.id, DEFAULT_AGENT_ID)).run();
}

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
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe('chat pipeline (方案 1:聊天前独立情绪抽取)', () => {
  it('extraction before reply: state event emitted before text, reply passes through clean', async () => {
    zeroAgentState();
    const pipeline = await runChatPipeline(
      handle, baseBody, NOW,
      () => fakeLlm('辛苦啦,早点休息。'),
      undefined,
      extractLow5,
    );

    const response = createChatResponse(handle, pipeline, NOW);
    const sse = await readSse(response);
    expect(sse).toContain('辛苦啦,早点休息。');
    // 事件先于文本(方案 1:情绪在聊天前独立抽取)
    const eventIdx = sse.indexOf('data-agent-state-event');
    const textIdx = sse.indexOf('text-delta');
    expect(eventIdx).toBeGreaterThan(-1);
    expect(eventIdx).toBeLessThan(textIdx);

    const lastAssistant = handle.sqlite
      .prepare("SELECT content, status, error_code FROM messages WHERE conversation_id = 'conv_pipe' AND role = 'assistant' ORDER BY created_at DESC, id DESC LIMIT 1")
      .get() as { content: string; status: string; error_code: string | null };
    expect(lastAssistant.content).toBe('辛苦啦,早点休息。');

    const event = handle.sqlite
      .prepare('SELECT * FROM state_events WHERE trigger_message_id = ?')
      .get(pipeline.userMessageId) as Record<string, unknown>;
    expect(event.rule_version).toBe('emotion-llm-v2');
    expect(event.discrete_tag).toBe('low');
    expect(event.source).toBe('user_message');

    const agent = handle.db.select().from(agents).where(eq(agents.id, DEFAULT_AGENT_ID)).get()!;
    // low | 5 → valence -0.3, arousal -0.15, dominance -0.1
    expect(agent.currentTag).toBe('low');
    expect(agent.currentValence).toBeCloseTo(-0.3, 5);
    expect(agent.currentArousal).toBeCloseTo(-0.15, 5);
    expect(agent.currentDominance).toBeCloseTo(-0.1, 5);
    expect(agent.stateUpdatedAt).toBe(NOW);
  });

  it('emits no state event when extraction returns null', async () => {
    zeroAgentState();
    const body = { ...baseBody, message: '今天天气不错', clientMessageId: 'client_pipe_2' };
    const pipeline = await runChatPipeline(
      handle, body, NOW,
      () => fakeLlm('是呀'),
      undefined,
      extractNull,
    );

    const response = createChatResponse(handle, pipeline, NOW);
    const sse = await readSse(response);
    expect(sse).not.toContain('data-agent-state-event');
    expect(sse).toContain('是呀');

    const eventCount = handle.sqlite
      .prepare('SELECT COUNT(*) AS n FROM state_events')
      .get() as { n: number };
    const before = handle.sqlite
      .prepare("SELECT COUNT(*) AS n FROM state_events WHERE trigger_message_id != ?")
      .get(pipeline.userMessageId) as { n: number };
    expect(eventCount.n).toBe(before.n);
  });

  it('throws LLM_REQUEST_FAILED when factory fails', async () => {
    const body = { ...baseBody, clientMessageId: 'client_pipe_3' };
    await expect(
      runChatPipeline(handle, body, NOW, () => {
        throw new LlmRequestFailedError('no key');
      }, undefined, extractNull),
    ).rejects.toBeInstanceOf(LlmRequestFailedError);

    const failedCount = handle.sqlite
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = 'conv_pipe' AND status = 'failed' AND error_code = 'LLM_REQUEST_FAILED'")
      .get() as { n: number };
    expect(failedCount.n).toBeGreaterThanOrEqual(1);
  });

  it('emotion engine off: no extraction, no state event', async () => {
    vi.stubEnv('EMOTION_ENGINE', 'off');
    zeroAgentState();
    const before = handle.db.select().from(agents).where(eq(agents.id, DEFAULT_AGENT_ID)).get()!;
    const body = { ...baseBody, message: '今天好累', clientMessageId: 'client_pipe_off' };
    const pipeline = await runChatPipeline(
      handle, body, NOW,
      () => fakeLlm('好的。'),
      undefined,
      extractLow5, // 引擎关时不应该被调用
    );

    const response = createChatResponse(handle, pipeline, NOW);
    const sse = await readSse(response);
    expect(sse).not.toContain('data-agent-state-event');
    expect(sse).toContain('好的。');

    const after = handle.db.select().from(agents).where(eq(agents.id, DEFAULT_AGENT_ID)).get()!;
    expect(after.currentValence).toBe(before.currentValence);
    expect(after.currentTag).toBe(before.currentTag);
  });

  it('marks assistant failed when stream text rejects', async () => {
    vi.unstubAllEnvs();
    const body = { ...baseBody, message: '平静', clientMessageId: 'client_pipe_4' };
    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: 'text-delta', id: 'fake', delta: 'partial' });
      },
    });
    const pipeline = await runChatPipeline(handle, body, NOW, () => ({
      text: Promise.reject(new Error('midstream failure')),
      toUimessageStream: () => stream as never,
    }), undefined, extractNull);

    const response = createChatResponse(handle, pipeline, NOW);
    await readSse(response);

    const failedCount = handle.sqlite
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = 'conv_pipe' AND status = 'failed' AND error_code = 'LLM_REQUEST_FAILED'")
      .get() as { n: number };
    expect(failedCount.n).toBeGreaterThanOrEqual(1);
  });

  it('applies baseline regression before the new delta and injects the emotion line into the prompt', async () => {
    vi.unstubAllEnvs();
    // 快照 valence 0.4,6 小时前更新(= 一个半程)→ 展示态回归到 0.2;
    // 抽取 low|5 → delta -0.3 → after -0.1
    handle.db.update(agents).set({
      currentValence: 0.4,
      currentArousal: 0,
      currentDominance: 0,
      currentTag: 'calm',
      stateUpdatedAt: '2026-11-11T18:00:00.000Z',
      updatedAt: '2026-11-11T18:00:00.000Z',
    }).where(eq(agents.id, DEFAULT_AGENT_ID)).run();

    let capturedSystem: string | undefined;
    const pipeline = await runChatPipeline(
      handle,
      { ...baseBody, clientMessageId: 'client_pipe_regression' },
      NOW,
      (prompt) => {
        capturedSystem = prompt.system;
        return fakeLlm('好的。');
      },
      undefined,
      extractLow5,
    );

    expect(capturedSystem).toContain('【当前情绪状态】');
    // 抽取 low|5 已生效:after valence -0.1, arousal -0.15 → tag low
    expect(capturedSystem).toContain('low');

    const sse = await readSse(createChatResponse(handle, pipeline, NOW));
    const eventLine = sse.split('\n').find((l) => l.includes('data-agent-state-event'))!;
    const frame = JSON.parse(eventLine.replace(/^data:\s*/, '')) as {
      data: { event: { before: { valence: number }; after: { valence: number } } };
    };
    expect(frame.data.event.before.valence).toBeCloseTo(0.2, 5);
    expect(frame.data.event.after.valence).toBeCloseTo(-0.1, 5);
  });

  it('deltas arrive before text-end on the wire', async () => {
    zeroAgentState();
    const body = { ...baseBody, clientMessageId: 'client_pipe_short' };
    const pipeline = await runChatPipeline(handle, body, NOW, () => fakeLlm('是呀'), undefined, extractNull);
    const sse = await readSse(createChatResponse(handle, pipeline, NOW));
    const types = sse.split('\n')
      .filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'))
      .map((l) => (JSON.parse(l.slice('data: '.length)) as { type: string }).type);
    const lastDelta = types.lastIndexOf('text-delta');
    const firstEnd = types.indexOf('text-end');
    expect(lastDelta).toBeGreaterThan(-1);
    expect(firstEnd).toBeGreaterThan(lastDelta);
  });
});
