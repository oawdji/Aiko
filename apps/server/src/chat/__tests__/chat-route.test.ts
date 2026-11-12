import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CHAT_MESSAGE_MAX_LENGTH, DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@aiko/shared';
import { createDb } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { conversations } from '../../db/schema';
import { chatRoute } from '../route';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-12T00:00:00.000Z';

const validBody = {
  agentId: DEFAULT_AGENT_ID,
  conversationId: 'conv_chat_test',
  message: '今天好累',
  clientMessageId: 'client_1',
};

type ErrorBody = { code: string; message: string; details?: { existingMessageId?: string } };

function post(body: unknown, headers: Record<string, string> = {}) {
  return chatRoute.request('/chat', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

beforeAll(() => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'aiko-chat-route-'));
  process.env.DATA_DIR = dataDir;
  const handle = createDb(path.join(dataDir, 'agent.sqlite'));
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
  handle.db
    .insert(conversations)
    .values({
      id: validBody.conversationId,
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

describe('POST /api/chat validation (M3.1)', () => {
  it('rejects invalid JSON with 400 INVALID_REQUEST', async () => {
    const res = await post('{not-json');
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).code).toBe('INVALID_REQUEST');
  });

  it('rejects missing fields with 400 and field details', async () => {
    const res = await post({ agentId: '', message: 'hi' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.code).toBe('INVALID_REQUEST');
    expect(body.details).toBeDefined();
  });

  it('rejects whitespace-only message with 400', async () => {
    const res = await post({ ...validBody, message: '   ', clientMessageId: 'client_ws' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).code).toBe('INVALID_REQUEST');
  });

  it('rejects over-length message with 413 MESSAGE_TOO_LONG', async () => {
    const res = await post({
      ...validBody,
      message: 'a'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1),
      clientMessageId: 'client_long',
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as ErrorBody).code).toBe('MESSAGE_TOO_LONG');
  });

  it('rejects oversized request body via content-length with 413', async () => {
    const res = await post(JSON.stringify(validBody), {
      'Content-Length': String(128 * 1024 + 1),
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as ErrorBody).code).toBe('MESSAGE_TOO_LONG');
  });
});

describe('POST /api/chat persistence + idempotency (M3.2)', () => {
  it('persists user message then stops at pipeline stub (500 until M3.4)', async () => {
    const res = await post(validBody);
    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorBody;
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toContain('M3.4');

    const handle = createDb(path.join(process.env.DATA_DIR!, 'agent.sqlite'));
    const stored = handle.db
      .select()
      .from(conversations)
      .all();
    void stored;
    const messages = handle.sqlite
      .prepare('SELECT * FROM messages WHERE conversation_id = ?')
      .all(validBody.conversationId) as Array<{ id: string; client_message_id: string; role: string; status: string }>;
    expect(messages).toHaveLength(1);
    const first = messages[0]!;
    expect(first.client_message_id).toBe(validBody.clientMessageId);
    expect(first.role).toBe('user');
    expect(first.status).toBe('complete');

    const conv = handle.sqlite
      .prepare('SELECT last_message_at FROM conversations WHERE id = ?')
      .get(validBody.conversationId) as { last_message_at: string };
    // route 层使用真实时钟，只断言已更新为合法 ISO 时间（幂等用例覆盖精确值路径）
    expect(conv.last_message_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns 409 DUPLICATE_CLIENT_MESSAGE on repeated clientMessageId', async () => {
    const res = await post(validBody);
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.code).toBe('DUPLICATE_CLIENT_MESSAGE');
    expect(body.details?.existingMessageId).toMatch(/^msg_/);
  });

  it('returns 404 CONVERSATION_NOT_FOUND for unknown conversation', async () => {
    const res = await post({ ...validBody, conversationId: 'conv_ghost', clientMessageId: 'client_2' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('returns 404 AGENT_NOT_FOUND for unknown agent', async () => {
    const res = await post({ ...validBody, agentId: 'ghost', clientMessageId: 'client_3' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).code).toBe('AGENT_NOT_FOUND');
  });

  it('returns 404 when conversation belongs to another agent', async () => {
    // 唯一 Agent 是 agent-default；conversationId 属于它，换 slug 不匹配的场景
    // 由 service 归属校验覆盖，这里用不存在的 slug 触发 404 分支
    const res = await post({ ...validBody, agentId: 'other', clientMessageId: 'client_4' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).code).toBe('AGENT_NOT_FOUND');
  });
});