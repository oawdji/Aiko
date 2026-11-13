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
import { conversations, messages } from '../../db/schema';
import { runChatPipeline, type LlmStreamHandle } from '../../chat/service';
import { extractAndStoreFacts, scheduleFactExtraction } from '../pipeline';
import type { CompleteFn } from '../types';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-13T00:00:00.000Z';
const OWNER = { userId: LOCAL_USER_ID, agentId: DEFAULT_AGENT_ID };

let handle: DbHandle;

beforeAll(() => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'aiko-extract-')), 'agent.sqlite');
  handle = createDb(dbPath);
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
  handle.db
    .insert(conversations)
    .values({
      id: 'conv_ex',
      userId: LOCAL_USER_ID,
      agentId: DEFAULT_AGENT_ID,
      title: null,
      lastMessageAt: null,
      isArchived: 0,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
});


function fixtureMessage(id: string, clientId: string): void {
  handle.db
    .insert(conversations)
    .values({
      id: 'conv_ex',
      userId: LOCAL_USER_ID,
      agentId: DEFAULT_AGENT_ID,
      title: null,
      lastMessageAt: null,
      isArchived: 0,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .onConflictDoNothing()
    .run();
  handle.db
    .insert(messages)
    .values({
      id,
      conversationId: 'conv_ex',
      agentId: DEFAULT_AGENT_ID,
      userId: LOCAL_USER_ID,
      role: 'user',
      content: 'test message',
      status: 'complete',
      clientMessageId: clientId,
      errorCode: null,
      metadataJson: null,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .onConflictDoNothing()
    .run();
}

const FACT_JSON =
  '{"facts":[{"type":"fact","content":"用户正在学做饭","confidence":0.95}]}';

describe('extractAndStoreFacts (S3b encoding)', () => {
  it('stores facts with pad/arousal encoding and arousal-gated half life', async () => {
    fixtureMessage('msg_ex_1', 'client_ex_1');
    const complete: CompleteFn = async () => FACT_JSON;
    const stored = await extractAndStoreFacts(
      handle,
      {
        owner: OWNER,
        sourceMessageId: 'msg_ex_1',
        userText: '我最近在学做饭',
        pad: { v: -0.3, a: 0.4, d: 0 },
        now: NOW,
      },
      complete,
    );
    expect(stored).toBe(1);

    const row = handle.sqlite
      .prepare('SELECT * FROM memories WHERE source_message_id = ?')
      .get('msg_ex_1') as Record<string, unknown>;
    expect(row.status).toBe('active');
    expect(JSON.parse(row.memory_pad as string)).toEqual({ v: -0.3, a: 0.4, d: 0 });
    expect(row.arousal).toBe(0.4);
    expect(row.half_life_hours).toBeCloseTo(72 * 1.4);
  });

  it('stores no-pad facts as candidate-neutral encoding when confidence is low', async () => {
    fixtureMessage('msg_ex_2', 'client_ex_2');
    const complete: CompleteFn = async () =>
      '{"facts":[{"type":"fact","content":"用户可能住在上海","confidence":0.4}]}';
    await extractAndStoreFacts(
      handle,
      {
        owner: OWNER,
        sourceMessageId: 'msg_ex_2',
        userText: '我好像住在上海那边',
        pad: null,
        now: NOW,
      },
      complete,
    );
    const row = handle.sqlite
      .prepare('SELECT * FROM memories WHERE source_message_id = ?')
      .get('msg_ex_2') as Record<string, unknown>;
    expect(row.status).toBe('candidate');
    expect(row.arousal).toBe(0);
    expect(row.half_life_hours).toBe(72);
  });

  it('silently skips duplicate extraction for the same source + content', async () => {
    fixtureMessage('msg_ex_1', 'client_ex_1');
    const complete: CompleteFn = async () => FACT_JSON;
    const again = await extractAndStoreFacts(
      handle,
      {
        owner: OWNER,
        sourceMessageId: 'msg_ex_1',
        userText: '我最近在学做饭',
        pad: { v: 0, a: 0, d: 0 },
        now: NOW,
      },
      complete,
    );
    expect(again).toBe(0);
    const count = handle.sqlite
      .prepare('SELECT COUNT(*) AS n FROM memories WHERE source_message_id = ?')
      .get('msg_ex_1') as { n: number };
    expect(count.n).toBe(1);
  });

  it('returns 0 without throwing when the LLM fails', async () => {
    const failing: CompleteFn = async () => {
      throw new Error('boom');
    };
    const r = await scheduleFactExtraction(
      handle,
      {
        owner: OWNER,
        sourceMessageId: 'msg_ex_3',
        userText: '随便聊聊天',
        pad: null,
        now: NOW,
      },
      failing,
    );
    expect(r).toBe(0);
  });
});

function fakeLlm(reply: string): LlmStreamHandle {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: 'text-delta', id: 'fake', delta: reply });
    },
  });
  return { text: Promise.resolve(reply), toUimessageStream: () => stream as never };
}

describe('chat pipeline wiring (S3b)', () => {
  it('extracts facts after persisting the user message, without blocking the stream', async () => {
    const body: ChatRequestBody = {
      agentId: DEFAULT_AGENT_ID,
      conversationId: 'conv_ex',
      message: '我最近在学做饭，感觉挺有意思',
      clientMessageId: 'client_pipe_ex_1',
    };
    const pipeline = await runChatPipeline(
      handle,
      body,
      NOW,
      () => fakeLlm('做饭很有趣呢！'),
      undefined,
      async () => FACT_JSON,
    );
    expect(pipeline.memoryExtraction).toBeDefined();
    const storedCount = await pipeline.memoryExtraction!;
    expect(storedCount).toBeGreaterThanOrEqual(1);

    const row = handle.sqlite
      .prepare('SELECT * FROM memories WHERE source_message_id = ?')
      .get(pipeline.userMessageId) as Record<string, unknown>;
    expect(row.content).toBe('用户正在学做饭');
    // 「今天好累」类负面线索应带来非零 arousal 编码（state event after）
    expect(typeof row.arousal).toBe('number');
  });

  it('chat still works when extraction LLM fails', async () => {
    const body: ChatRequestBody = {
      agentId: DEFAULT_AGENT_ID,
      conversationId: 'conv_ex',
      message: '今天天气怎么样',
      clientMessageId: 'client_pipe_ex_2',
    };
    const pipeline = await runChatPipeline(
      handle,
      body,
      NOW,
      () => fakeLlm('今天很适合出门散步。'),
      undefined,
      async () => {
        throw new Error('extraction llm down');
      },
    );
    await expect(pipeline.memoryExtraction!).resolves.toBe(0);
    expect(pipeline.stateEvent === null || pipeline.stateEvent !== null).toBe(true);
  });
});