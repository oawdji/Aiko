import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INITIAL_EVOLVABLE_JSON,
  PERSONA_CORE_HASH,
  PERSONA_CORE_MD,
} from '../generated/persona-core';
import { createDb } from '../client';
import { runMigrations } from '../migrate';
import {
  DEFAULT_PERSONA_ID,
  seedDefaultData,
} from '../seed';

// src/db/__tests__ -> server 为上三级，drizzle 位于 server/drizzle
const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');

function makeFreshHandle() {
  const dbPath = path.join(
    mkdtempSync(path.join(tmpdir(), 'aiko-seed-')),
    'agent.sqlite',
  );
  const handle = createDb(dbPath);
  runMigrations(handle, migrationsFolder);
  return handle;
}

describe('seedDefaultData', () => {
  it('seeds default agent with neutral initial state', () => {
    const handle = makeFreshHandle();
    seedDefaultData(handle, '2026-11-12T00:00:00.000Z');

    const agent = handle.sqlite
      .prepare('SELECT * FROM agents WHERE slug = ?')
      .get('default') as {
      id: string;
      current_valence: number;
      current_arousal: number;
      current_tag: string;
      active_persona_version: number;
    };

    expect(agent.id).toBe('agent-default');
    expect(agent.current_valence).toBe(0);
    expect(agent.current_arousal).toBe(0);
    expect(agent.current_tag).toBe('neutral');
    expect(agent.active_persona_version).toBe(1);
    handle.sqlite.close();
  });

  it('seeds persona version 1 with content and hash from the generated source', () => {
    const handle = makeFreshHandle();
    seedDefaultData(handle, '2026-11-12T00:00:00.000Z');

    const persona = handle.sqlite
      .prepare('SELECT * FROM persona_versions WHERE id = ?')
      .get(DEFAULT_PERSONA_ID) as {
      version: number;
      persona_core_md: string;
      persona_core_hash: string;
      evolvable_json: string;
      is_active: number;
    };

    expect(persona.version).toBe(1);
    expect(persona.is_active).toBe(1);
    expect(persona.persona_core_md).toBe(PERSONA_CORE_MD);
    expect(persona.persona_core_hash).toBe(PERSONA_CORE_HASH);
    expect(JSON.parse(persona.evolvable_json)).toEqual(
      JSON.parse(INITIAL_EVOLVABLE_JSON),
    );
    handle.sqlite.close();
  });

  it('seeds the five default settings with correct JSON values', () => {
    const handle = makeFreshHandle();
    seedDefaultData(handle, '2026-11-12T00:00:00.000Z');

    const rows = handle.sqlite
      .prepare('SELECT key, value_json FROM app_settings ORDER BY key')
      .all() as Array<{ key: string; value_json: string }>;
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value_json]));

    expect(byKey['default_agent_id']).toBe('"agent-default"');
    expect(byKey['recent_window_rounds']).toBe('15');
    expect(byKey['max_context_messages']).toBe('30');
    expect(byKey['theme']).toBe('"system"');
    expect(rows).toHaveLength(5);
    handle.sqlite.close();
  });

  it('is idempotent: re-seeding changes nothing', () => {
    const handle = makeFreshHandle();
    seedDefaultData(handle, '2026-11-12T00:00:00.000Z');

    const count = (table: string) =>
      (
        handle.sqlite
          .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
          .get() as { count: number }
      ).count;

    seedDefaultData(handle, '2026-11-12T01:00:00.000Z');

    expect(count('agents')).toBe(1);
    expect(count('persona_versions')).toBe(1);
    expect(count('app_settings')).toBe(5);
    handle.sqlite.close();
  });

  it('does not overwrite user-modified settings', () => {
    const handle = makeFreshHandle();
    seedDefaultData(handle, '2026-11-12T00:00:00.000Z');

    handle.sqlite
      .prepare("UPDATE app_settings SET value_json = '\"dark\"' WHERE key = 'theme'")
      .run();

    seedDefaultData(handle, '2026-11-12T01:00:00.000Z');

    const theme = handle.sqlite
      .prepare("SELECT value_json FROM app_settings WHERE key = 'theme'")
      .get() as { value_json: string };
    expect(theme.value_json).toBe('"dark"');
    handle.sqlite.close();
  });

  it('restores persona v1 when the row was deleted but agent remains', () => {
    const handle = makeFreshHandle();
    seedDefaultData(handle, '2026-11-12T00:00:00.000Z');

    handle.sqlite.prepare('DELETE FROM persona_versions').run();
    seedDefaultData(handle, '2026-11-12T01:00:00.000Z');

    const persona = handle.sqlite
      .prepare('SELECT persona_core_hash FROM persona_versions WHERE id = ?')
      .get(DEFAULT_PERSONA_ID) as { persona_core_hash: string };
    expect(persona.persona_core_hash).toBe(PERSONA_CORE_HASH);
    handle.sqlite.close();
  });
});