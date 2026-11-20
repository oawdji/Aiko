import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_AGENT_ID } from '@aiko/shared';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { conversations } from '../../db/schema';
import { runContextContributors } from '../../plugins/context-contributors';
import { loadExternalPlugins } from '../../plugins/loader';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-20T00:00:00.000Z';

let handle: DbHandle;
let app: Hono;

beforeAll(async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'aiko-bookshelf-'));
  process.env.DATA_DIR = dataDir;
  handle = createDb(path.join(dataDir, 'agent.sqlite'));
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
  handle.db.insert(conversations).values({
    id: 'conv_bs',
    userId: 'user_local',
    agentId: DEFAULT_AGENT_ID,
    title: null,
    lastMessageAt: null,
    isArchived: 0,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();
  app = new Hono();
  await loadExternalPlugins(undefined, app);
});

const facts = () => ({
  handle,
  agentId: DEFAULT_AGENT_ID,
  conversationId: 'conv_bs',
  userText: '你在看什么书',
  now: NOW,
  emotion: null,
  memoryHits: [],
  semanticHits: [],
});

describe('aiko-bookshelf 插件', () => {
  it('GET /api/books 初始为空', async () => {
    const res = await app.request('/api/books');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { books: unknown[] };
    expect(body.books).toHaveLength(0);
  });

  it('POST /api/books/upload 上传 TXT → 异步解析为 ready', async () => {
    const form = new FormData();
    form.append('file', new Blob(['第一章 初见\n她住在我的电脑里。\n第二章 相识\n我们聊了很多。'], { type: 'text/plain' }), '测试书.txt');
    const res = await app.request('/api/books/upload', { method: 'POST', body: form });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { book: { id: string; status: string } };
    expect(body.book.id).toMatch(/^book_/);

    // 等待异步解析完成
    await new Promise((r) => setTimeout(r, 300));
    const list = await app.request('/api/books');
    const listBody = (await list.json()) as { books: Array<{ id: string; status: string; totalChunks: number }> };
    const book = listBody.books.find((b) => b.id === body.book.id)!;
    expect(book.status).toBe('ready');
    expect(book.totalChunks).toBeGreaterThanOrEqual(1);
  });

  it('contributor 注入书架 + 知识边界', async () => {
    const out = await runContextContributors(facts());
    const shelf = out.find((t) => t.includes('### 你的书架'));
    expect(shelf).toBeDefined();
    expect(shelf!).toContain('测试书');
    expect(shelf!).toContain('坦率承认没读过');
  });

  it('GET /api/books/:id/chunks 返回切块', async () => {
    const list = await (await app.request('/api/books')).json() as { books: Array<{ id: string }> };
    const bookId = list.books[0]!.id;
    const res = await app.request('/api/books/' + bookId + '/chunks');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { chunks: Array<{ content: string; chapter: string | null }> };
    expect(body.chunks.length).toBeGreaterThanOrEqual(1);
    expect(body.chunks[0]!.content).toContain('她住在我的电脑里');
  });

  it('DELETE /api/books/:id 后列表为空', async () => {
    const list = await (await app.request('/api/books')).json() as { books: Array<{ id: string }> };
    const res = await app.request('/api/books/' + list.books[0]!.id, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const after = await (await app.request('/api/books')).json() as { books: unknown[] };
    expect(after.books).toHaveLength(0);
  });
});

