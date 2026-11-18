import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@aiko/shared';
import { conversations, messages } from '../../db/schema';
import { createDb } from '../../db/client';
import { getDb } from '../../db';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { personaRoute } from '../route';
import { proposePersona } from '../service';
import type { PersonaCompleteFn } from '../llm';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const T0 = new Date().toISOString();

let proposalId: string;

beforeAll(async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'aiko-persona-route-'));
  process.env.DATA_DIR = dataDir;
  const handle = createDb(path.join(dataDir, 'agent.sqlite'));
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, T0);
  handle.db.insert(conversations).values({
    id: 'conv_1',
    userId: LOCAL_USER_ID,
    agentId: DEFAULT_AGENT_ID,
    title: null,
    lastMessageAt: null,
    isArchived: 0,
    createdAt: T0,
    updatedAt: T0,
  }).run();
  handle.db.insert(messages).values({
    id: 'msg_1',
    conversationId: 'conv_1',
    agentId: DEFAULT_AGENT_ID,
    userId: LOCAL_USER_ID,
    role: 'user',
    content: '我在学做饭',
    status: 'complete',
    clientMessageId: 'client_1',
    createdAt: T0,
    updatedAt: T0,
  }).run();
  handle.sqlite.close();
  // getDb 单例在首次调用时读取 DATA_DIR
  const p = await proposePersona(
    getDb(),
    { agentId: DEFAULT_AGENT_ID, requestText: '幽默一点', now: T0 },
    (async () => JSON.stringify({ patch: { humor: 0.5 } })) as PersonaCompleteFn,
  );
  proposalId = p.id;
});

function post(url: string, body?: unknown) {
  return personaRoute.request(url, {
    method: 'POST',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe('persona route (P3)', () => {
  it('POST /persona/propose validates request body (400)', async () => {
    const res = await post('/persona/propose', { requestText: '' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; status: string; ok: boolean; version: number; evolvable: { verbosity: string }; proposals: unknown[]; versions: { version: number }[] };
    expect(body.code).toBe('INVALID_REQUEST');
  });

  it('POST /persona/propose respects rate limit (429) without touching LLM', async () => {
    const res = await post('/persona/propose', { requestText: '再幽默一点' });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { code: string; status: string; ok: boolean; version: number; evolvable: { verbosity: string }; proposals: unknown[]; versions: { version: number }[] };
    expect(body.code).toBe('PERSONA_RATE_LIMITED');
  });

  it('POST /persona/proposals/:id/reject returns rejected DTO (200)', async () => {
    const res = await post(`/persona/proposals/${proposalId}/reject`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; status: string; ok: boolean; version: number; evolvable: { verbosity: string }; proposals: unknown[]; versions: { version: number }[] };
    expect(body.status).toBe('rejected');
  });

  it('POST /persona/proposals/:id/approve creates version 2 (200)', async () => {
    const seed = await proposePersona(
      getDb(),
      { agentId: DEFAULT_AGENT_ID, requestText: '简洁一点', now: new Date(Date.now() + 121 * 60000).toISOString() },
      (async () => JSON.stringify({ patch: { verbosity: 'concise' } })) as PersonaCompleteFn,
    );
    const res = await post(`/persona/proposals/${seed.id}/approve`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; status: string; ok: boolean; version: number; evolvable: { verbosity: string }; proposals: unknown[]; versions: { version: number }[] };
    expect(body.ok).toBe(true);
    expect(body.version).toBe(3);
    expect(body.evolvable.verbosity).toBe('concise');
  });

  it('approve again returns 409 PERSONA_PROPOSAL_STATE', async () => {
    void proposalId;
    const seed = await proposePersona(
      getDb(),
      { agentId: DEFAULT_AGENT_ID, requestText: 'x', now: new Date(Date.now() + 242 * 60000).toISOString() },
      (async () => JSON.stringify({ patch: { humor: 0.4 } })) as PersonaCompleteFn,
    );
    await post(`/persona/proposals/${seed.id}/approve`);
    const res = await post(`/persona/proposals/${seed.id}/approve`);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; status: string; ok: boolean; version: number; evolvable: { verbosity: string }; proposals: unknown[]; versions: { version: number }[] };
    expect(body.code).toBe('PERSONA_PROPOSAL_STATE');
  });

  it('approve unknown id returns 404', async () => {
    const res = await post('/persona/proposals/prop_none/approve');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string; status: string; ok: boolean; version: number; evolvable: { verbosity: string }; proposals: unknown[]; versions: { version: number }[] };
    expect(body.code).toBe('PERSONA_PROPOSAL_NOT_FOUND');
  });

  it('GET /persona/proposals lists proposals', async () => {
    const res = await personaRoute.request('/persona/proposals');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; status: string; ok: boolean; version: number; evolvable: { verbosity: string }; proposals: unknown[]; versions: { version: number }[] };
    expect(Array.isArray(body.proposals)).toBe(true);
    expect(body.proposals.length).toBeGreaterThan(0);
  });

  it('GET /persona/versions lists versions newest first', async () => {
    const res = await personaRoute.request('/persona/versions');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; status: string; ok: boolean; version: number; evolvable: { verbosity: string }; proposals: unknown[]; versions: { version: number }[] };
    expect(body.versions[0]!.version).toBeGreaterThan(2);
  });

  it('POST /persona/versions/1/rollback creates a new version (200)', async () => {
    const res = await post('/persona/versions/2/rollback');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; status: string; ok: boolean; version: number; evolvable: { verbosity: string }; proposals: unknown[]; versions: { version: number }[] };
    expect(body.ok).toBe(true);
    expect(body.evolvable.verbosity).toBe('balanced');
  });

  it('rollback invalid version returns 400', async () => {
    const res = await post('/persona/versions/abc/rollback');
    expect(res.status).toBe(400);
  });
});

describe('persona core manual edit (P4.5)', () => {
  it('GET /persona/core returns current core', async () => {
    const res = await personaRoute.request('/persona/core');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: number; personaCoreHash: string; coreMd: string };
    expect(body.version).toBeGreaterThan(0);
    expect(body.coreMd.length).toBeGreaterThan(0);
  });

  it('PUT /persona/core updates core with new version (200)', async () => {
    const res = await personaRoute.request('/persona/core', {
      method: 'PUT',
      body: JSON.stringify({ coreMd: '你是 Aiko。（路由编辑版）' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: number; personaCoreHash: string };
    expect(body.ok).toBe(true);
    const get = await personaRoute.request('/persona/core');
    const getBody = (await get.json()) as { version: number; coreMd: string };
    expect(getBody.coreMd).toBe('你是 Aiko。（路由编辑版）');
    expect(getBody.version).toBe(body.version);
  });

  it('PUT /persona/core rejects empty core (400)', async () => {
    const res = await personaRoute.request('/persona/core', {
      method: 'PUT',
      body: JSON.stringify({ coreMd: '   ' }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('PERSONA_PATCH_INVALID');
  });
});
