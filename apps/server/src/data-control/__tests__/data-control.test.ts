import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@aiko/shared';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { dataControlRoute } from '../route';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-13T00:00:00.000Z';

let handle: DbHandle;

beforeAll(() => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'aiko-datactl-'));
  process.env.DATA_DIR = dataDir;
  handle = createDb(path.join(dataDir, 'agent.sqlite'));
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
  handle.sqlite
    .prepare(
      "INSERT OR IGNORE INTO conversations (id, user_id, agent_id, is_archived, created_at, updated_at) VALUES ('conv_dc', ?, ?, 0, ?, ?)",
    )
    .run(LOCAL_USER_ID, DEFAULT_AGENT_ID, NOW, NOW);
  handle.sqlite
    .prepare(
      "INSERT OR IGNORE INTO messages (id, conversation_id, agent_id, user_id, role, content, status, client_message_id, created_at, updated_at) VALUES ('msg_dc', 'conv_dc', ?, ?, 'user', '我在学做饭', 'complete', 'client_dc', ?, ?)",
    )
    .run(DEFAULT_AGENT_ID, LOCAL_USER_ID, NOW, NOW);
  handle.sqlite
    .prepare(
      "INSERT INTO memories (id, user_id, agent_id, type, content, source_message_id, confidence, status, memory_pad, arousal, half_life_hours, strength, created_at, updated_at) VALUES ('mem_dc_keep', ?, ?, 'fact', '用户正在学做饭', 'msg_dc', 0.9, 'active', '{\"v\":0,\"a\":0,\"d\":0}', 0, 72, 1, ?, ?)",
    )
    .run(LOCAL_USER_ID, DEFAULT_AGENT_ID, NOW, NOW);
  handle.sqlite
    .prepare(
      "INSERT INTO memories (id, user_id, agent_id, type, content, source_message_id, confidence, status, memory_pad, arousal, half_life_hours, strength, created_at, updated_at) VALUES ('mem_dc_del', ?, ?, 'fact', '已删除的内容', 'msg_dc', 0.9, 'deleted', '{\"v\":0,\"a\":0,\"d\":0}', 0, 72, 1, ?, ?)",
    )
    .run(LOCAL_USER_ID, DEFAULT_AGENT_ID, NOW, NOW);
});

describe('GET /api/export (F32/F18)', () => {
  it('exports active memories and audit-only deleted records', async () => {
    const res = await dataControlRoute.request('/export');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      format: string;
      memories: Array<{ id: string; content: string }>;
      deletedMemoriesAudit: Array<{ id: string; content?: string }>;
      messages: unknown[];
    };
    expect(body.format).toBe('aiko-export-v1');
    expect(body.memories.map((m) => m.id)).toEqual(['mem_dc_keep']);
    expect(body.messages).toHaveLength(1);
    expect(body.deletedMemoriesAudit).toHaveLength(1);
    expect(body.deletedMemoriesAudit[0]!.content).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('已删除的内容');
  });
});

describe('DELETE /api/data (F33)', () => {
  it('clears user data, keeps persona + settings, resets state', async () => {
    const res = await dataControlRoute.request('/data', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      counts: Record<string, number>;
      derivedDataPolicy: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.counts.messages).toBe(1);
    expect(body.counts.memories).toBe(2);
    expect(body.derivedDataPolicy.length).toBeGreaterThan(0);

    const n = (t: string) =>
      (handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    expect(n('messages')).toBe(0);
    expect(n('conversations')).toBe(0);
    expect(n('memories')).toBe(0);
    expect(n('conversation_summaries')).toBe(0);
    expect(n('prompt_snapshots')).toBe(0);
    expect(n('agents')).toBe(1);
    expect(n('persona_versions')).toBe(1);
    expect(n('app_settings')).toBeGreaterThan(0);
    const agent = handle.sqlite
      .prepare('SELECT current_valence, baseline_valence FROM agents WHERE id = ?')
      .get(DEFAULT_AGENT_ID) as { current_valence: number; baseline_valence: number };
    expect(agent.current_valence).toBe(agent.baseline_valence);
  });

  it('DELETE is idempotent on empty data', async () => {
    const res = await dataControlRoute.request('/data', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; counts: Record<string, number> };
    expect(body.ok).toBe(true);
    expect(body.counts.messages).toBe(0);
  });
});
