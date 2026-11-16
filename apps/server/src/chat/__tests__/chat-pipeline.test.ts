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

/** 把 agent 情绪快照归零,让事件数值可精确预测。 */
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

describe('chat pipeline (A 方案:LLM 情绪自评)', () => {
  it('strips the emotion marker from the reply, persists clean text, emits state event after text', async () => {
    zeroAgentState();
    const reply = '辛苦啦,早点休息。\n[[emotion: low | 5 | 用户很疲惫]]';
    const pipeline = await runChatPipeline(handle, baseBody, NOW, () => fakeLlm(reply));

    const response = createChatResponse(handle, pipeline, NOW);
    const sse = await readSse(response);
    // 标记被剥离,不进入用户可见流
    expect(sse).toContain('辛苦啦,早点休息。');
    expect(sse).not.toContain('[[emotion');
    // 事件后置于文本(A 方案:情绪只能来自模型回复)
    const eventIdx = sse.indexOf('data-agent-state-event');
    const textIdx = sse.indexOf('text-delta');
    expect(eventIdx).toBeGreaterThan(textIdx);
    expect(eventIdx).toBeGreaterThan(-1);

    const lastAssistant = handle.sqlite
      .prepare("SELECT content, status, error_code FROM messages WHERE conversation_id = 'conv_pipe' AND role = 'assistant' ORDER BY created_at DESC, id DESC LIMIT 1")
      .get() as { content: string; status: string; error_code: string | null };
    expect(lastAssistant.content).toBe('辛苦啦,早点休息。');

    const event = handle.sqlite
      .prepare('SELECT * FROM state_events WHERE trigger_message_id = ?')
      .get(pipeline.userMessageId) as Record<string, unknown>;
    expect(event.rule_version).toBe('emotion-llm-v1');
    expect(event.discrete_tag).toBe('low');
    expect(event.source).toBe('user_message');

    const agent = handle.db.select().from(agents).where(eq(agents.id, DEFAULT_AGENT_ID)).get()!;
    // low | 5 → valence -0.3,arousal -0.15
    expect(agent.currentTag).toBe('low');
    expect(agent.currentValence).toBeCloseTo(-0.3, 5);
    expect(agent.currentArousal).toBeCloseTo(-0.15, 5);
    expect(agent.stateUpdatedAt).toBe(NOW);
  });

  it('emits no state event when reply has no emotion marker', async () => {
    zeroAgentState();
    const body = { ...baseBody, message: '今天天气不错', clientMessageId: 'client_pipe_2' };
    const pipeline = await runChatPipeline(handle, body, NOW, () => fakeLlm('是呀'));

    const response = createChatResponse(handle, pipeline, NOW);
    const sse = await readSse(response);
    expect(sse).not.toContain('data-agent-state-event');
    expect(sse).toContain('是呀');

    const event = handle.sqlite
      .prepare('SELECT COUNT(*) AS n FROM state_events WHERE trigger_message_id = ?')
      .get(pipeline.userMessageId) as { n: number };
    expect(event.n).toBe(0);
  });

  it('ignores invalid marker tags (no state event, marker still stripped)', async () => {
    zeroAgentState();
    const body = { ...baseBody, clientMessageId: 'client_pipe_bad' };
    const reply = '好的。\n[[emotion: angry | 3 | 非法标签]]';
    const pipeline = await runChatPipeline(handle, body, NOW, () => fakeLlm(reply));
    const sse = await readSse(createChatResponse(handle, pipeline, NOW));
    expect(sse).not.toContain('data-agent-state-event');
    expect(sse).toContain('好的。');
    expect(sse).not.toContain('[[emotion');

    const event = handle.sqlite
      .prepare('SELECT COUNT(*) AS n FROM state_events WHERE trigger_message_id = ?')
      .get(pipeline.userMessageId) as { n: number };
    expect(event.n).toBe(0);
  });

  it('writes failed assistant placeholder and throws LLM_REQUEST_FAILED when factory fails', async () => {
    const body = { ...baseBody, clientMessageId: 'client_pipe_3' };
    await expect(
      runChatPipeline(handle, body, NOW, () => {
        throw new LlmRequestFailedError('no key');
      }),
    ).rejects.toBeInstanceOf(LlmRequestFailedError);

    const failedCount = handle.sqlite
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = 'conv_pipe' AND status = 'failed' AND error_code = 'LLM_REQUEST_FAILED'")
      .get() as { n: number };
    expect(failedCount.n).toBeGreaterThanOrEqual(1);
  });

  it('emotion engine off: marker stripped but no state event and no protocol in prompt', async () => {
    vi.stubEnv('EMOTION_ENGINE', 'off');
    zeroAgentState();
    const before = handle.db.select().from(agents).where(eq(agents.id, DEFAULT_AGENT_ID)).get()!;
    const body = { ...baseBody, message: '今天好累', clientMessageId: 'client_pipe_off' };
    let capturedSystem = '';
    const pipeline = await runChatPipeline(handle, body, NOW, (prompt) => {
      capturedSystem = prompt.system;
      return fakeLlm('好的。\n[[emotion: happy | 5 | 气氛不错]]');
    });
    expect(capturedSystem).not.toContain('情绪自评协议');

    const response = createChatResponse(handle, pipeline, NOW);
    const sse = await readSse(response);
    expect(sse).not.toContain('data-agent-state-event');
    expect(sse).not.toContain('[[emotion');
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
    }));

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
    // 回复标记 happy|5 → delta +0.25 → after 0.45
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
        return fakeLlm('好的。\n[[emotion: happy | 5 | 气氛不错]]');
      },
    );

    expect(capturedSystem).toContain('【当前情绪状态】');
    expect(capturedSystem).toContain('calm');
    expect(capturedSystem).toContain('强制输出协议');

    const sse = await readSse(createChatResponse(handle, pipeline, NOW));
    const eventLine = sse.split('\n').find((l) => l.includes('data-agent-state-event'))!;
    const frame = JSON.parse(eventLine.replace(/^data:\s*/, '')) as {
      data: { event: { before: { valence: number }; after: { valence: number } } };
    };
    expect(frame.data.event.before.valence).toBeCloseTo(0.2, 5);
    expect(frame.data.event.after.valence).toBeCloseTo(0.45, 5);
  });

  it('short reply (< marker buffer): deltas still arrive before text-end on the wire', async () => {
    zeroAgentState();
    const body = { ...baseBody, clientMessageId: 'client_pipe_short' };
    const pipeline = await runChatPipeline(handle, body, NOW, () => fakeLlm('是呀'));
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
