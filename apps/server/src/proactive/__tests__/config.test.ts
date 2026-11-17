import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { loadProactiveConfig } from '../config';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-17T00:00:00.000Z';
let handle: DbHandle;

beforeAll(() => {
  handle = createDb(path.join(mkdtempSync(path.join(tmpdir(), 'aiko-proactive-')), 'agent.sqlite'));
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
});

describe('loadProactiveConfig', () => {
  it('returns seeded defaults', () => {
    const c = loadProactiveConfig(handle);
    expect(c).toEqual({
      enabled: false,
      idleMinutes: 30,
      maxPer24h: 3,
      quietStart: '22:00',
      quietEnd: '08:00',
      minIntervalMinutes: 60,
    });
  });

  it('reflects user-modified settings', () => {
    handle.sqlite
      .prepare("UPDATE app_settings SET value_json = 'true' WHERE key = 'proactive_enabled'")
      .run();
    const c = loadProactiveConfig(handle);
    expect(c.enabled).toBe(true);
    handle.sqlite
      .prepare("UPDATE app_settings SET value_json = 'false' WHERE key = 'proactive_enabled'")
      .run();
  });

  it('falls back to defaults for missing or corrupt keys', () => {
    handle.sqlite.prepare("DELETE FROM app_settings WHERE key = 'proactive_idle_minutes'").run();
    handle.sqlite
      .prepare("UPDATE app_settings SET value_json = '\"oops\"' WHERE key = 'proactive_max_per_24h'")
      .run();
    const c = loadProactiveConfig(handle);
    expect(c.idleMinutes).toBe(30);
    expect(c.maxPer24h).toBe(3);
  });
});
