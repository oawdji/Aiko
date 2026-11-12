import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
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

const baseBody: ChatRequestBody = {
  agentId: DEFAULT_AGENT_ID,
  conversationId: 'conv_pipe',
  message: '今天好累',
  clientMessageId: 'client_pipe_1',
};

function fakeLlm(reply: string): LlmStreamHandle {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: 'text-delta', id: 'fake', delta: reply });
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

describe('chat pipeline (M3.4)', () => {
  it('persists user + assistant messages, emits state event before text, updates agent snapshot', async () => {
    const pipeline = await runChatPipeline(handle, baseBody, NOW, () => fakeLlm('辛苦啦，早点休息。'));
    expect(pipeline.stateEvent).not.toBeNull();
    expect(pipeline.stateEvent?.discreteTag).toBe('low');

    const response = createChatResponse(handle, pipeline, NOW);
    const sse = await readSse(response);

    const eventIndex = sse.indexOf('data-agent-state-event');
    const textIndex = sse.indexOf('text-delta');
    expect(eventIndex).toBeGreaterThan(-1);
    expect(textIndex).toBeGreaterThan(eventIndex);
    expect(sse).toContain('辛苦啦');

    const stored = handle.sqlite
      .prepare("SELECT role, status, content, error_code FROM messages WHERE conversation_id = ? ORDER BY created_at, CASE role WHEN 'user' THEN 0 ELSE 1 END")
      .all('conv_pipe') as Array<{ role: string; status: string; content: string; error_code: string | null }>;
    expect(stored.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(stored[1]!.status).toBe('complete');
    expect(stored[1]!.content).toBe('辛苦啦，早点休息。');
    expect(stored[1]!.error_code).toBeNull();

    const event = handle.sqlite
      .prepare('SELECT * FROM state_events WHERE trigger_message_id = ?')
      .get(pipeline.userMessageId) as Record<string, unknown>;
    expect(event.rule_version).toBe('emotion-rules-v1');
    expect(event.discrete_tag).toBe('low');
    expect(event.source).toBe('user_message');

    const agent = handle.db.select().from(agents).where(eq(agents.id, DEFAULT_AGENT_ID)).get()!;
    expect(agent.currentTag).toBe('low');
    expect(agent.currentValence).toBeCloseTo(-0.1);
    expect(agent.currentArousal).toBeCloseTo(-0.04);
    expect(agent.stateUpdatedAt).toBe(NOW);
  });

  it('skips state event when message has no emotion clue', async () => {
    const body = { ...baseBody, message: '今天天气不错', clientMessageId: 'client_pipe_2' };
    const pipeline = await runChatPipeline(handle, body, NOW, () => fakeLlm('是呀'));
    expect(pipeline.stateEvent).toBeNull();

    const response = createChatResponse(handle, pipeline, NOW);
    const sse = await readSse(response);
    expect(sse).not.toContain('data-agent-state-event');
    expect(sse).toContain('是呀');
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

  it('emotion engine off: no state event and agent snapshot unchanged', async () => {
    const before = handle.db.select().from(agents).where(eq(agents.id, DEFAULT_AGENT_ID)).get()!;
    const body = { ...baseBody, message: '今天好累', clientMessageId: 'client_pipe_off' };
    const pipeline = await runChatPipeline(handle, body, NOW, () => fakeLlm('好的'), () => null);
    expect(pipeline.stateEvent).toBeNull();

    const response = createChatResponse(handle, pipeline, NOW);
    const sse = await readSse(response);
    expect(sse).not.toContain('data-agent-state-event');
    expect(sse).toContain('好的');

    const after = handle.db.select().from(agents).where(eq(agents.id, DEFAULT_AGENT_ID)).get()!;
    expect(after.currentValence).toBe(before.currentValence);
    expect(after.currentArousal).toBe(before.currentArousal);
    expect(after.currentTag).toBe(before.currentTag);
  });
  it('marks assistant failed when stream text rejects', async () => {
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
});