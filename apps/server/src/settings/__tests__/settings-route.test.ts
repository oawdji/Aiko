import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { settingsRoute } from '../route';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-12T00:00:00.000Z';

type ErrorBody = { code: string; message: string };

beforeAll(() => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'aiko-settings-route-'));
  process.env.DATA_DIR = dataDir;
  const handle = createDb(path.join(dataDir, 'agent.sqlite'));
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
  vi.stubEnv('LLM_API_KEY', '');
  vi.stubEnv('LLM_BASE_URL', '');
  vi.stubEnv('LLM_MODEL', '');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function patch(body: unknown) {
  return settingsRoute.request('/settings', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('settings routes (api-contract §11/§12)', () => {
  it('GET returns settings with masked llm info', async () => {
    const res = await settingsRoute.request('/settings');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body.settings as Record<string, unknown>).theme).toBe('system');
    expect((body.llm as Record<string, unknown>).apiKeyConfigured).toBe(false);
    expect((body.llm as Record<string, unknown>).apiKeyHint).toBeNull();
  });

  it('PATCH validates the body against the shared schema', async () => {
    const res = await patch({ theme: 'invalid' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).code).toBe('INVALID_REQUEST');
  });

  it('PATCH updates llm config and returns masked response', async () => {
    const res = await patch({ llmApiKey: 'sk-secret-9999' });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain('sk-secret-9999');
    const body = JSON.parse(raw) as { llm: { apiKeyConfigured: boolean; apiKeyHint: string | null } };
    expect(body.llm.apiKeyConfigured).toBe(true);
    expect(body.llm.apiKeyHint).toBe('****9999');
  });

  it('PATCH rejects odd maxContextMessages with 400', async () => {
    const res = await patch({ maxContextMessages: 25 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).code).toBe('INVALID_REQUEST');
  });

  it('llm test reports not-configured as ok:false without leaking details', async () => {
    const res = await settingsRoute.request('/settings/llm/test', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; errorCode: string | null };
    expect(body.ok).toBe(false);
    expect(body.errorCode).toBe('LLM_REQUEST_FAILED');
  });
});