import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDb } from '../client';

const tempDir = mkdtempSync(path.join(tmpdir(), 'aiko-db-'));

describe('createDb', () => {
  it('creates the database file and parent directories', () => {
    const dbPath = path.join(tempDir, 'nested', 'agent.sqlite');
    const handle = createDb(dbPath);

    expect(existsSync(dbPath)).toBe(true);
    handle.sqlite.close();
  });

  it('applies the required pragmas from database-schema.md §8', () => {
    const handle = createDb(path.join(tempDir, 'pragma.sqlite'));

    expect(handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(String(handle.sqlite.pragma('journal_mode', { simple: true }))).toBe('wal');
    expect(handle.sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);

    handle.sqlite.close();
  });
});