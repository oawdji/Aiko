import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDb } from '../client';
import { runMigrations } from '../migrate';

// src/db/__tests__ -> server 为上三级，drizzle 位于 server/drizzle
const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');

const EXPECTED_TABLES = [
  'agents',
  'app_settings',
  'conversations',
  'messages',
  'persona_versions',
  'state_events',
];

describe('runMigrations', () => {
  it('creates all six tables on a fresh database', () => {
    const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'aiko-mig-')), 'agent.sqlite');
    const handle = createDb(dbPath);

    runMigrations(handle, migrationsFolder);

    const tables = handle.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'")
      .all()
      .map((row) => (row as { name: string }).name)
      .sort();

    expect(tables).toEqual([...EXPECTED_TABLES].sort());
    handle.sqlite.close();
  });

  it('is idempotent when run twice', () => {
    const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'aiko-mig-')), 'agent.sqlite');
    const handle = createDb(dbPath);

    runMigrations(handle, migrationsFolder);
    expect(() => runMigrations(handle, migrationsFolder)).not.toThrow();

    const applied = handle.sqlite
      .prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations')
      .get() as { count: number };
    expect(applied.count).toBe(2);

    handle.sqlite.close();
  });
});