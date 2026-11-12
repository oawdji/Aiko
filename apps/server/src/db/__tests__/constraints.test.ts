import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../client';
import { runMigrations } from '../migrate';
import { seedDefaultData } from '../seed';

// src/db/__tests__ -> server 为上三级，drizzle 位于 server/drizzle
const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-12T00:00:00.000Z';

function freshDb(): DbHandle {
  const dbPath = path.join(
    mkdtempSync(path.join(tmpdir(), 'aiko-c-')),
    'agent.sqlite',
  );
  const handle = createDb(dbPath);
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
  return handle;
}

function fixtureConversation(handle: DbHandle): void {
  handle.sqlite
    .prepare(
      `INSERT INTO conversations
         (id, user_id, agent_id, is_archived, created_at, updated_at)
       VALUES ('conv_1', 'local-user', 'agent-default', 0, '${NOW}', '${NOW}')`,
    )
    .run();
  handle.sqlite
    .prepare(
      `INSERT INTO messages
         (id, conversation_id, agent_id, user_id, role, content, status,
          client_message_id, created_at, updated_at)
       VALUES ('msg_1', 'conv_1', 'agent-default', 'local-user', 'user',
               '你好', 'complete', 'client_1', '${NOW}', '${NOW}')`,
    )
    .run();
}

describe('database constraints (M1.6)', () => {
  it('rejects a conversation referencing a nonexistent agent', () => {
    const handle = freshDb();
    expect(() =>
      handle.sqlite
        .prepare(
          `INSERT INTO conversations
             (id, user_id, agent_id, is_archived, created_at, updated_at)
           VALUES ('conv_x', 'local-user', 'agent-missing', 0, '${NOW}', '${NOW}')`,
        )
        .run(),
    ).toThrow();
    handle.sqlite.close();
  });

  it('rejects a message referencing a nonexistent conversation', () => {
    const handle = freshDb();
    expect(() =>
      handle.sqlite
        .prepare(
          `INSERT INTO messages
             (id, conversation_id, agent_id, user_id, role, content, status,
              client_message_id, created_at, updated_at)
           VALUES ('msg_x', 'conv_missing', 'agent-default', 'local-user',
                   'user', '你好', 'complete', 'client_x', '${NOW}', '${NOW}')`,
        )
        .run(),
    ).toThrow();
    handle.sqlite.close();
  });

  it('enforces unique agent slug', () => {
    const handle = freshDb();
    expect(() =>
      handle.sqlite
        .prepare(
          `INSERT INTO agents
             (id, slug, display_name, current_valence, current_arousal,
              current_tag, active_persona_version, created_at, updated_at)
           VALUES ('agent_other', 'default', '重复', 0, 0, 'neutral', 1,
                   '${NOW}', '${NOW}')`,
        )
        .run(),
    ).toThrow();
    handle.sqlite.close();
  });

  it('rejects out-of-range emotion values on agents', () => {
    const handle = freshDb();
    expect(() =>
      handle.sqlite
        .prepare('UPDATE agents SET current_valence = 1.5 WHERE id = ?')
        .run('agent-default'),
    ).toThrow();
    handle.sqlite.close();
  });

  it('rejects an invalid discrete tag on agents', () => {
    const handle = freshDb();
    expect(() =>
      handle.sqlite
        .prepare("UPDATE agents SET current_tag = 'angry' WHERE id = ?")
        .run('agent-default'),
    ).toThrow();
    handle.sqlite.close();
  });

  it('enforces unique (conversation_id, client_message_id) on messages', () => {
    const handle = freshDb();
    fixtureConversation(handle);
    expect(() =>
      handle.sqlite
        .prepare(
          `INSERT INTO messages
             (id, conversation_id, agent_id, user_id, role, content, status,
              client_message_id, created_at, updated_at)
           VALUES ('msg_dup', 'conv_1', 'agent-default', 'local-user', 'user',
                   '重复', 'complete', 'client_1', '${NOW}', '${NOW}')`,
        )
        .run(),
    ).toThrow();
    handle.sqlite.close();
  });

  it('allows multiple assistant messages with NULL client_message_id', () => {
    const handle = freshDb();
    fixtureConversation(handle);
    const insert = handle.sqlite.prepare(
      `INSERT INTO messages
         (id, conversation_id, agent_id, user_id, role, content, status,
          created_at, updated_at)
       VALUES (?, 'conv_1', 'agent-default', 'local-user', 'assistant',
               '回复', 'complete', '${NOW}', '${NOW}')`,
    );
    expect(() => insert.run('msg_a1')).not.toThrow();
    expect(() => insert.run('msg_a2')).not.toThrow();
    handle.sqlite.close();
  });

  it('rejects a user message without client_message_id', () => {
    const handle = freshDb();
    fixtureConversation(handle);
    expect(() =>
      handle.sqlite
        .prepare(
          `INSERT INTO messages
             (id, conversation_id, agent_id, user_id, role, content, status,
              client_message_id, created_at, updated_at)
           VALUES ('msg_nouid', 'conv_1', 'agent-default', 'local-user',
                   'user', '无ID', 'complete', NULL, '${NOW}', '${NOW}')`,
        )
        .run(),
    ).toThrow();
    handle.sqlite.close();
  });

  it('rejects a failed message without error_code', () => {
    const handle = freshDb();
    fixtureConversation(handle);
    expect(() =>
      handle.sqlite
        .prepare(
          `INSERT INTO messages
             (id, conversation_id, agent_id, user_id, role, content, status,
              client_message_id, error_code, created_at, updated_at)
           VALUES ('msg_fail', 'conv_1', 'agent-default', 'local-user',
                   'assistant', '失败', 'failed', NULL, NULL, '${NOW}', '${NOW}')`,
        )
        .run(),
    ).toThrow();
    handle.sqlite.close();
  });

  it('rejects invalid metadata JSON on messages', () => {
    const handle = freshDb();
    fixtureConversation(handle);
    expect(() =>
      handle.sqlite
        .prepare(
          `INSERT INTO messages
             (id, conversation_id, agent_id, user_id, role, content, status,
              client_message_id, metadata_json, created_at, updated_at)
           VALUES ('msg_badjson', 'conv_1', 'agent-default', 'local-user',
                   'user', '你好', 'complete', 'client_2', '{broken',
                   '${NOW}', '${NOW}')`,
        )
        .run(),
    ).toThrow();
    handle.sqlite.close();
  });

  it('rejects a user_message state event without trigger message', () => {
    const handle = freshDb();
    fixtureConversation(handle);
    expect(() =>
      handle.sqlite
        .prepare(
          `INSERT INTO state_events
             (id, agent_id, conversation_id, trigger_message_id, source,
              rule_version, before_valence, before_arousal, delta_valence,
              delta_arousal, after_valence, after_arousal, discrete_tag,
              reason, evidence_text, confidence, created_at)
           VALUES ('state_x', 'agent-default', 'conv_1', NULL, 'user_message',
                   'emotion-rules-v1', 0, 0, -0.1, -0.04, -0.1, -0.04, 'low',
                   '原因', '证据', 0.7, '${NOW}')`,
        )
        .run(),
    ).toThrow();
    handle.sqlite.close();
  });

  it('enforces the state event idempotency unique constraint', () => {
    const handle = freshDb();
    fixtureConversation(handle);
    const insert = handle.sqlite.prepare(
      `INSERT INTO state_events
         (id, agent_id, conversation_id, trigger_message_id, source,
          rule_version, before_valence, before_arousal, delta_valence,
          delta_arousal, after_valence, after_arousal, discrete_tag,
          reason, evidence_text, confidence, created_at)
       VALUES (?, 'agent-default', 'conv_1', 'msg_1', 'user_message',
               'emotion-rules-v1', 0, 0, -0.1, -0.04, -0.1, -0.04, 'low',
               '原因', '累', 0.7, '${NOW}')`,
    );
    expect(() => insert.run('state_1')).not.toThrow();
    expect(() => insert.run('state_2')).toThrow();
    handle.sqlite.close();
  });

  it('rejects out-of-range confidence on state events', () => {
    const handle = freshDb();
    fixtureConversation(handle);
    expect(() =>
      handle.sqlite
        .prepare(
          `INSERT INTO state_events
             (id, agent_id, conversation_id, trigger_message_id, source,
              rule_version, before_valence, before_arousal, delta_valence,
              delta_arousal, after_valence, after_arousal, discrete_tag,
              reason, evidence_text, confidence, created_at)
           VALUES ('state_c', 'agent-default', 'conv_1', 'msg_1', 'user_message',
                   'emotion-rules-v1', 0, 0, -0.1, -0.04, -0.1, -0.04, 'low',
                   '原因', '累', 1.5, '${NOW}')`,
        )
        .run(),
    ).toThrow();
    handle.sqlite.close();
  });

  it('rejects out-of-range dominance on agents', () => {
    const handle = freshDb();
    expect(() =>
      handle.sqlite.prepare('UPDATE agents SET current_dominance = 1.5 WHERE id = ?').run('agent-default'),
    ).toThrow();
    handle.sqlite.close();
  });

  it('rejects out-of-range baseline values on agents', () => {
    const handle = freshDb();
    expect(() =>
      handle.sqlite.prepare('UPDATE agents SET baseline_valence = -1.5 WHERE id = ?').run('agent-default'),
    ).toThrow();
    handle.sqlite.close();
  });

  it('rejects non-positive decay_half_life_hours on agents', () => {
    const handle = freshDb();
    expect(() =>
      handle.sqlite.prepare('UPDATE agents SET decay_half_life_hours = 0 WHERE id = ?').run('agent-default'),
    ).toThrow();
    handle.sqlite.close();
  });

  it('rejects out-of-range dominance on state events', () => {
    const handle = freshDb();
    fixtureConversation(handle);
    expect(() =>
      handle.sqlite
        .prepare(
          `INSERT INTO state_events
             (id, agent_id, conversation_id, trigger_message_id, source,
              rule_version, before_valence, before_arousal, delta_valence,
              delta_arousal, after_valence, after_arousal, discrete_tag,
              reason, evidence_text, confidence, created_at, after_dominance)
           VALUES ('state_d', 'agent-default', 'conv_1', 'msg_1', 'user_message',
                   'emotion-rules-v1', 0, 0, -0.1, -0.04, -0.1, -0.04, 'low',
                   '原因', '累', 0.7, '${NOW}', 1.5)`,
        )
        .run(),
    ).toThrow();
    handle.sqlite.close();
  });

  it('rejects invalid JSON in app_settings', () => {
    const handle = freshDb();
    expect(() =>
      handle.sqlite
        .prepare(
          `INSERT INTO app_settings (key, value_json, updated_at)
           VALUES ('bad_key', '{broken', '${NOW}')`,
        )
        .run(),
    ).toThrow();
    handle.sqlite.close();
  });
});