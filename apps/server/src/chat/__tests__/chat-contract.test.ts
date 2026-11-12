import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createUIMessageStream } from 'ai';
import { ApiErrorSchema, DEFAULT_AGENT_ID, LOCAL_USER_ID, type ChatRequestBody } from '@aiko/shared';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { conversations } from '../../db/schema';
import { chatRoute } from '../route';
import { createChatResponse, runChatPipeline, type LlmStreamHandle } from '../service';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-12T00:00:00.000Z';

let handle: DbHandle;

beforeAll(() => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'aiko-chat-contract-'));
  process.env.DATA_DIR = dataDir;
  const dbPath = path.join(dataDir, 'agent.sqlite');
  handle = createDb(dbPath);
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
  handle.db.insert(conversations).values({
    id: 'conv_contract',
    userId: LOCAL_USER_ID,
    agentId: DEFAULT_AGENT_ID,
    title: null,
    lastMessageAt: null,
    isArchived: 0,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();
});

const body: ChatRequestBody = {
  agentId: DEFAULT_AGENT_ID,
  conversationId: 'conv_contract',
  message: '今天好累',
  clientMessageId: 'client_contract_1',
};

function fakeLlm(reply: string): LlmStreamHandle {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: 'text-delta', id: 'fake', delta: reply });
    },
  });
  return { text: Promise.resolve(reply), toUimessageStream: () => stream as never };
}

async function readSse(response: Response): Promise<string[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }
  return raw.split('\n').filter((line) => line.startsWith('data:'));
}

describe('chat SSE wire format (api-contract.md §13.6/§13.7, Phase 0 实测记录)', () => {
  it('emits only data: frames; data part carries id equal to state event id', async () => {
    const pipeline = await runChatPipeline(handle, body, NOW, () => fakeLlm('好好休息。'));
    const response = createChatResponse(handle, pipeline, NOW);

    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const frames = await readSse(response);
    expect(frames.length).toBeGreaterThan(0);

    const parsed = frames
    .filter((frame) => !frame.includes('[DONE]'))
    .map((frame) => JSON.parse(frame.slice('data:'.length)) as Record<string, unknown>);
    const eventFrame = parsed.find((p) => p.type === 'data-agent-state-event') as {
      id: string;
      data: { event: { id: string } };
    };
    expect(eventFrame).toBeDefined();
    // 线格式：顶层 id 与事件 id 一致（Phase 0 实测记录 #2）
    expect(eventFrame.id).toBe(eventFrame.data.event.id);

    const deltaFrame = parsed.find((p) => p.type === 'text-delta') as { delta: string };
    // v7 文本增量字段名：delta（Phase 0 实测记录 #3）
    expect(deltaFrame).toBeDefined();
    expect(deltaFrame.delta).toBe('好好休息。');

    // 顺序：data part 帧在首个 text-delta 帧之前（Phase 0 实测记录 #4）
    const eventIdx = parsed.findIndex((p) => p.type === 'data-agent-state-event');
    const deltaIdx = parsed.findIndex((p) => p.type === 'text-delta');
    expect(eventIdx).toBeLessThan(deltaIdx);
  });
});

describe('chat error responses use unified ApiError structure (§4.8/§17.2)', () => {
  async function expectApiError(init: { body: unknown; status: number; code: string }) {
    const res = await chatRoute.request('/chat', {
      method: 'POST',
      body: typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(init.status);
    const json: unknown = await res.json();
    const parsed = ApiErrorSchema.safeParse(json);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe(init.code);
  }

  it('400 INVALID_REQUEST', async () => {
    await expectApiError({ body: '{}', status: 400, code: 'INVALID_REQUEST' });
  });

  it('413 MESSAGE_TOO_LONG', async () => {
    await expectApiError({
      body: { ...body, message: 'a'.repeat(9000), clientMessageId: 'c_x' },
      status: 413,
      code: 'MESSAGE_TOO_LONG',
    });
  });

  it('404 CONVERSATION_NOT_FOUND', async () => {
    await expectApiError({
      body: { ...body, conversationId: 'conv_none', clientMessageId: 'c_y' },
      status: 404,
      code: 'CONVERSATION_NOT_FOUND',
    });
  });

  it('404 AGENT_NOT_FOUND', async () => {
    await expectApiError({
      body: { ...body, agentId: 'ghost', clientMessageId: 'c_z' },
      status: 404,
      code: 'AGENT_NOT_FOUND',
    });
  });

  it('409 DUPLICATE_CLIENT_MESSAGE with stable details.existingMessageId', async () => {
    const first = await chatRoute.request('/chat', {
      method: 'POST',
      body: JSON.stringify({ ...body, clientMessageId: 'client_contract_dup' }),
      headers: { 'Content-Type': 'application/json' },
    });
    if (first.status !== 500) console.log('first body', await first.clone().text());
    expect(first.status).toBe(500); // LLM 未配置，但用户消息已入库

    const second = await chatRoute.request('/chat', {
      method: 'POST',
      body: JSON.stringify({ ...body, clientMessageId: 'client_contract_dup' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(second.status).toBe(409);
    const json: unknown = await second.json();
    const parsed = ApiErrorSchema.safeParse(json);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.code).toBe('DUPLICATE_CLIENT_MESSAGE');
      expect((parsed.data.details as { existingMessageId: string }).existingMessageId).toMatch(/^msg_/);
    }
  });
});
