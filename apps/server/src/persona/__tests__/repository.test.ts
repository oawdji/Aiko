import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_ID } from '@aiko/shared';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import {
  assertPersonaCoreIntact,
  getActivePersona,
  PersonaCoreIntegrityError,
} from '../repository';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-16T00:00:00.000Z';
let handle: DbHandle;

beforeAll(() => {
  handle = createDb(path.join(mkdtempSync(path.join(tmpdir(), 'aiko-persona-')), 'agent.sqlite'));
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
});

describe('persona repository (P1)', () => {
  it('returns active persona with normalized evolvable (snake_case legacy)', () => {
    const p = getActivePersona(handle, DEFAULT_AGENT_ID);
    expect(p).not.toBeNull();
    expect(p!.version).toBe(5);
    expect(p!.evolvable.verbosity).toBe('balanced');
    expect(p!.evolvable.warmth).toBe(0.7);
    expect(p!.evolvable.proactiveQuestions).toBe(0.6);
    expect(p!.evolvable.notes).toEqual([]);
  });

  it('returns null for agent without active persona', () => {
    expect(getActivePersona(handle, 'agent_missing')).toBeNull();
  });

  it('passes integrity check on seeded data', () => {
    expect(() => assertPersonaCoreIntact(handle, DEFAULT_AGENT_ID)).not.toThrow();
  });

  it('throws when active core is tampered', () => {
    handle.sqlite
      .prepare("UPDATE persona_versions SET persona_core_md = '被篡改的锚点' WHERE version = 5")
      .run();
    expect(() => assertPersonaCoreIntact(handle, DEFAULT_AGENT_ID)).toThrow(
      PersonaCoreIntegrityError,
    );
  });
});
