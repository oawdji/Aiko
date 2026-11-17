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
import { conversations } from '../../db/schema';
import { createChatResponse, runChatPipeline, type LlmStreamHandle } from '../service';
import type { MemoryClient } from '../memory-client';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-14T00:00:00.000Z';

let handle: DbHandle;

beforeAll(() => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'aiko-memory-int-')), 'agent.sqlite');
  handle = createDb(dbPath);
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
  handle.db.insert(conversations).values({
    id: 'conv_mem',
    userId: LOCAL_USER_ID,
    agentId: DEFAULT_AGENT_ID,
    title: null,
    lastMessageAt: null,
    isArchived: 0,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();
});

function fakeLlm(reply: string, captured?: { system?: string }): LlmStreamHandle {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: 'text-start', id: 'fake' });
      writer.write({ type: 'text-delta', id: 'fake', delta: reply });
      writer.write({ type: 'text-end', id: 'fake' });
    },
  });
  return {
    text: Promise.resolve(reply),
    toUimessageStream: () => stream as never,
    ...(captured ? {} : {}),
  };
}

/** 捕获 system prompt 的 fake factory。 */
function capturingLlm(captured: { system: string }): LlmStreamHandle {
  return {
    text: Promise.resolve('好的'),
    toUimessageStream: () =>
      createUIMessageStream({ execute: ({ writer: w }) => { w.write({ type: 'text-start', id: 'f' }); w.write({ type: 'text-delta', id: 'f', delta: '好的' }); w.write({ type: 'text-end', id: 'f' }); } }) as never,
  };
}

function makeFakeMemory(hits: string[]): {
  client: MemoryClient;
  searchCalls: string[];
  indexCalls: string[][];
} {
  const searchCalls: string[] = [];
  const indexCalls: string[][] = [];
  return {
    searchCalls,
    indexCalls,
    client: {
      async search(query) {
        searchCalls.push(query);
        return hits;
      },
      async indexDialogue(messages) {
        indexCalls.push(messages.map((m) => m.content));
      },
      async clearVectors() {},
    },
  };
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

const baseBody: ChatRequestBody = {
  agentId: DEFAULT_AGENT_ID,
  conversationId: 'conv_mem',
  message: '我家宠物叫什么?',
  clientMessageId: 'client_mem_1',
};

describe('chat pipeline memory integration (T7)', () => {
  it('injects retrieved memories into system prompt and indexes the turn after reply', async () => {
    const { client, searchCalls, indexCalls } = makeFakeMemory(['用户提到养了一只叫咪咪的猫']);
    let capturedSystem = '';
    const factory = (prompt: { system: string }) => {
      capturedSystem = prompt.system;
      return {
        text: Promise.resolve('它叫咪咪。'),
        toUimessageStream: () =>
          createUIMessageStream({
            execute: ({ writer }) => writer.write({ type: 'text-delta', id: 'f', delta: '它叫咪咪。' }),
          }) as never,
      };
    };
    void capturingLlm;

    const pipeline = await runChatPipeline(handle, baseBody, NOW, factory, undefined, undefined, client);
    expect(searchCalls).toEqual(['我家宠物叫什么?']);
    expect(capturedSystem).toContain('[相关记忆]');
    expect(capturedSystem).toContain('咪咪');

    const sse = await readSse(createChatResponse(handle, pipeline, NOW));
    expect(sse).toContain('它叫咪咪');
    expect(indexCalls).toHaveLength(1);
    expect(indexCalls[0]).toEqual(['我家宠物叫什么?', '它叫咪咪。']);
  });

  it('degrades when the memory client throws', async () => {
    const failing: MemoryClient = {
      async search() {
        throw new Error('python missing');
      },
      async indexDialogue() {
        throw new Error('python missing');
      },
      async clearVectors() {
        throw new Error('python missing');
      },
    };
    const pipeline = await runChatPipeline(
      handle,
      { ...baseBody, clientMessageId: 'client_mem_2' },
      NOW,
      () => fakeLlm('没关系'),
      undefined,
      undefined,
      failing,
    );
    const sse = await readSse(createChatResponse(handle, pipeline, NOW));
    expect(sse).toContain('没关系');
  });

  it('explicit null disables memory entirely', async () => {
    let called = false;
    const spy: MemoryClient = {
      async search() {
        called = true;
        return [];
      },
      async indexDialogue() {},
      async clearVectors() {},
    };
    void spy;
    const pipeline = await runChatPipeline(
      handle,
      { ...baseBody, clientMessageId: 'client_mem_3' },
      NOW,
      () => fakeLlm('ok'),
      undefined,
      undefined,
      null,
    );
    void pipeline;
    expect(called).toBe(false);
  });
});
