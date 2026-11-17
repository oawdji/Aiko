import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@aiko/shared';
import { conversations } from '../../db/schema';
import { createDb } from '../../db/client';
import { getDb } from '../../db';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { proactiveRoute } from '../route';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const T0 = '2026-11-17T12:00:00.000Z';

beforeAll(() => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'aiko-proactive-route-'));
  process.env.DATA_DIR = dataDir;
  const handle = createDb(path.join(dataDir, 'agent.sqlite'));
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, T0);
  handle.db.insert(conversations).values({
    id: 'conv_r',
    userId: LOCAL_USER_ID,
    agentId: DEFAULT_AGENT_ID,
    title: null,
    lastMessageAt: null,
    isArchived: 0,
    createdAt: T0,
    updatedAt: T0,
  }).run();
  handle.sqlite.close();
});

function post(url: string, body: unknown) {
  return proactiveRoute.request(url, { method: 'POST', body: JSON.stringify(body) });
}

describe('proactive route (P4)', () => {
  it('evaluate returns send:false when disabled (200)', async () => {
    const res = await post('/proactive/evaluate', { conversationId: 'conv_r', localMinutesOfDay: 600 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { send: boolean; reason: string };
    expect(body.send).toBe(false);
    expect(body.reason).toBe('disabled');
  });

  it('validates request body (400)', async () => {
    const res = await post('/proactive/evaluate', { conversationId: 'conv_r', localMinutesOfDay: 9999 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_REQUEST');
  });

  it('unknown conversation returns 404', async () => {
    // 开启开关以穿过 policy，命中会话校验
    const db = getDb();
    db.sqlite
      .prepare("UPDATE app_settings SET value_json = 'true' WHERE key = 'proactive_enabled'")
      .run();
    const res = await post('/proactive/evaluate', { conversationId: 'conv_missing', localMinutesOfDay: 600 });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('PROACTIVE_CONVERSATION_NOT_FOUND');
    // 还原关闭
    db.sqlite
      .prepare("UPDATE app_settings SET value_json = 'false' WHERE key = 'proactive_enabled'")
      .run();
  });

  it('GET history returns list', async () => {
    const res = await proactiveRoute.request('/proactive/history');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: unknown[] };
    expect(Array.isArray(body.messages)).toBe(true);
  });
});
