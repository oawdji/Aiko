import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createUIMessageStream } from 'ai';
import { eq } from 'drizzle-orm';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@aiko/shared';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { conversations, messages } from '../../db/schema';
import { conversationsRoute } from '../route';
import { ConversationAgentNotFoundError, createConversation } from '../service';
import {
  ChatConversationNotFoundError,
  RegenerateNotApplicableError,
  createChatResponse,
  runRegeneratePipeline,
  type LlmStreamHandle,
} from '../../chat/service';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-17T00:00:00.000Z';

let handle: DbHandle;
let convSeq = 0;

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

function newConversation(): string {
  const id = `conv_regen_${++convSeq}`;
  handle.db
    .insert(conversations)
    .values({
      id,
      userId: LOCAL_USER_ID,
      agentId: DEFAULT_AGENT_ID,
      title: null,
      lastMessageAt: null,
      isArchived: 0,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
  return id;
}

function insertMessage(params: {
  conversationId: string;
  id: string;
  role: 'user' | 'assistant';
  status?: 'complete' | 'failed' | 'streaming';
  content?: string;
  errorCode?: string | null;
  metadataJson?: string | null;
  createdAt: string;
}): void {
  handle.db
    .insert(messages)
    .values({
      id: params.id,
      conversationId: params.conversationId,
      agentId: DEFAULT_AGENT_ID,
      userId: LOCAL_USER_ID,
      role: params.role,
      content: params.content ?? '内容 ' + params.id,
      status: params.status ?? 'complete',
      clientMessageId: params.role === 'user' ? 'client_' + params.id : null,
      errorCode: params.errorCode ?? null,
      metadataJson: params.metadataJson ?? null,
      createdAt: params.createdAt,
      updatedAt: params.createdAt,
    })
    .run();
}

function rowsOf(conversationId: string) {
  return handle.db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .all()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

beforeAll(() => {
  // 路由层经 getDb() 单例打开同一 DATA_DIR 数据库
  const dataDir = mkdtempSync(path.join(tmpdir(), 'aiko-conv-regen-'));
  process.env.DATA_DIR = dataDir;
  handle = createDb(path.join(dataDir, 'agent.sqlite'));
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
});

describe('createConversation（服务层）', () => {
  it('创建空白会话：归属正确、无消息', () => {
    const created = createConversation(handle, DEFAULT_AGENT_ID, NOW);
    expect(created.id).toMatch(/^conv_/);
    expect(created.agentId).toBe(DEFAULT_AGENT_ID);
    expect(created.lastMessageAt).toBeNull();
    expect(rowsOf(created.id)).toHaveLength(0);
  });

  it('未知 agent 抛出 ConversationAgentNotFoundError', () => {
    expect(() => createConversation(handle, 'agent_none', NOW)).toThrow(
      ConversationAgentNotFoundError,
    );
  });
});

describe('POST /api/conversations（路由）', () => {
  it('201 + conversation DTO', async () => {
    const res = await conversationsRoute.request('/conversations', {
      method: 'POST',
      body: JSON.stringify({ agentId: DEFAULT_AGENT_ID }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { conversation: { id: string; agentId: string } };
    expect(body.conversation.id).toMatch(/^conv_/);
    expect(body.conversation.agentId).toBe(DEFAULT_AGENT_ID);
  });

  it('400：缺少 agentId', async () => {
    const res = await conversationsRoute.request('/conversations', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('404：未知 agent', async () => {
    const res = await conversationsRoute.request('/conversations', {
      method: 'POST',
      body: JSON.stringify({ agentId: 'agent_none' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('AGENT_NOT_FOUND');
  });
});

describe('runRegeneratePipeline', () => {
  it('完整回复：旧消息标记 SUPERSEDED，新回复落库，不新增 user 消息与状态事件', async () => {
    const convId = newConversation();
    insertMessage({ conversationId: convId, id: 'r_u1', role: 'user', createdAt: '2026-11-17T01:00:00.000Z', content: '今天好累' });
    insertMessage({ conversationId: convId, id: 'r_a1', role: 'assistant', createdAt: '2026-11-17T01:01:00.000Z', content: '旧回复' });

    const pipeline = await runRegeneratePipeline(
      handle,
      { conversationId: convId },
      '2026-11-17T02:00:00.000Z',
      () => fakeLlm('新回复'),
      null,
    );
    expect(pipeline.stateEvent).toBeNull();
    expect(pipeline.userMessageId).toBe('r_u1');

    // assistant 消息在流结束时落库，必须消费流
    await readSse(createChatResponse(handle, pipeline, '2026-11-17T02:00:00.000Z'));

    const rows = rowsOf(convId);
    const superseded = rows.find((r) => r.id === 'r_a1');
    expect(superseded?.status).toBe('failed');
    expect(superseded?.errorCode).toBe('SUPERSEDED');
    expect(superseded?.content).toBe('（已重新生成）');

    const newReply = rows.at(-1);
    expect(newReply?.role).toBe('assistant');
    expect(newReply?.status).toBe('complete');
    expect(newReply?.content).toBe('新回复');
    expect(rows.filter((r) => r.role === 'user')).toHaveLength(1);
  });

  it('失败占位重试：生成新的完整回复', async () => {
    const convId = newConversation();
    insertMessage({ conversationId: convId, id: 'f_u1', role: 'user', createdAt: '2026-11-17T03:00:00.000Z', content: '帮我想想' });
    insertMessage({
      conversationId: convId,
      id: 'f_a1',
      role: 'assistant',
      status: 'failed',
      content: '（生成失败）',
      errorCode: 'LLM_REQUEST_FAILED',
      createdAt: '2026-11-17T03:01:00.000Z',
    });

    const pipeline = await runRegeneratePipeline(
      handle,
      { conversationId: convId },
      '2026-11-17T04:00:00.000Z',
      () => fakeLlm('重试成功'),
      null,
    );
    await readSse(createChatResponse(handle, pipeline, '2026-11-17T04:00:00.000Z'));

    const rows = rowsOf(convId);
    expect(rows.at(-1)?.content).toBe('重试成功');
    expect(rows.filter((r) => r.status === 'failed')).toHaveLength(1); // 仅旧占位被标记 SUPERSEDED
  });

  it('最后一条是 user 消息 → 拒绝', async () => {
    const convId = newConversation();
    insertMessage({ conversationId: convId, id: 'x_u1', role: 'user', createdAt: '2026-11-17T05:00:00.000Z' });
    await expect(
      runRegeneratePipeline(handle, { conversationId: convId }, NOW, undefined, null),
    ).rejects.toThrow(RegenerateNotApplicableError);
  });

  it('最后一条是主动消息 → 拒绝', async () => {
    const convId = newConversation();
    insertMessage({
      conversationId: convId,
      id: 'p_a1',
      role: 'assistant',
      metadataJson: JSON.stringify({ proactive: true, strategy: 'memory_recall' }),
      createdAt: '2026-11-17T06:00:00.000Z',
    });
    await expect(
      runRegeneratePipeline(handle, { conversationId: convId }, NOW, undefined, null),
    ).rejects.toThrow(RegenerateNotApplicableError);
  });

  it('最后一条 streaming 中 → 拒绝', async () => {
    const convId = newConversation();
    insertMessage({
      conversationId: convId,
      id: 's_a1',
      role: 'assistant',
      status: 'streaming',
      createdAt: '2026-11-17T07:00:00.000Z',
    });
    await expect(
      runRegeneratePipeline(handle, { conversationId: convId }, NOW, undefined, null),
    ).rejects.toThrow(RegenerateNotApplicableError);
  });

  it('没有任何 user 消息可基于 → 拒绝', async () => {
    const convId = newConversation();
    insertMessage({ conversationId: convId, id: 'n_a1', role: 'assistant', createdAt: '2026-11-17T08:00:00.000Z' });
    await expect(
      runRegeneratePipeline(handle, { conversationId: convId }, NOW, undefined, null),
    ).rejects.toThrow(RegenerateNotApplicableError);
  });

  it('会话不存在 → ChatConversationNotFoundError', async () => {
    await expect(
      runRegeneratePipeline(handle, { conversationId: 'conv_missing' }, NOW, undefined, null),
    ).rejects.toThrow(ChatConversationNotFoundError);
  });
});

describe('POST /api/conversations/:id/regenerate（路由错误映射）', () => {
  it('409：最后一条是 user 消息', async () => {
    const convId = newConversation();
    insertMessage({ conversationId: convId, id: 'rt_u1', role: 'user', createdAt: '2026-11-17T09:00:00.000Z' });
    const res = await conversationsRoute.request(`/conversations/${convId}/regenerate`, {
      method: 'POST',
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('REGENERATE_NOT_APPLICABLE');
  });

  it('404：会话不存在', async () => {
    const res = await conversationsRoute.request('/conversations/conv_missing/regenerate', {
      method: 'POST',
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('CONVERSATION_NOT_FOUND');
  });
});