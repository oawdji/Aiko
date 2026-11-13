import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../client';
import { runMigrations } from '../migrate';
import { seedDefaultData } from '../seed';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-13T00:00:00.000Z';
const OWNER = { userId: 'local-user', agentId: 'agent-default' };

function freshDb(): DbHandle {
  const dbPath = path.join(
    mkdtempSync(path.join(tmpdir(), 'aiko-mem-')),
    'agent.sqlite',
  );
  const handle = createDb(dbPath);
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
  return handle;
}

function fixtureMessage(handle: DbHandle, id = 'msg_1'): void {
  handle.sqlite
    .prepare(
      `INSERT OR IGNORE INTO conversations
         (id, user_id, agent_id, is_archived, created_at, updated_at)
       VALUES ('conv_1', '${OWNER.userId}', '${OWNER.agentId}', 0, '${NOW}', '${NOW}')`,
    )
    .run();
  handle.sqlite
    .prepare(
      `INSERT OR IGNORE INTO messages
         (id, conversation_id, agent_id, user_id, role, content, status,
          client_message_id, created_at, updated_at)
       VALUES ('${id}', 'conv_1', '${OWNER.agentId}', '${OWNER.userId}',
               'user', '我在学做饭', 'complete', 'client_${id}', '${NOW}', '${NOW}')`,
    )
    .run();
}

function insertMemory(
  handle: DbHandle,
  overrides: Record<string, unknown> = {},
): void {
  fixtureMessage(handle);
  const row = {
    id: 'mem_1',
    ...OWNER,
    type: 'fact',
    content: '用户正在学做饭',
    sourceMessageId: 'msg_1',
    confidence: 0.9,
    status: 'active',
    memoryPad: JSON.stringify({ v: -0.2, a: 0.3, d: 0 }),
    arousal: 0.3,
    halfLifeHours: 93.6,
    strength: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
  handle.sqlite
    .prepare(
      `INSERT INTO memories
         (id, user_id, agent_id, type, content, source_message_id, confidence,
          status, memory_pad, arousal, half_life_hours, strength,
          created_at, updated_at)
       VALUES (@id, @userId, @agentId, @type, @content, @sourceMessageId,
               @confidence, @status, @memoryPad, @arousal, @halfLifeHours,
               @strength, @createdAt, @updatedAt)`,
    )
    .run(row as never);
}

describe('memories table constraints (S1)', () => {
  it('inserts a valid memory with owner and source message', () => {
    const handle = freshDb();
    expect(() => insertMemory(handle)).not.toThrow();
    const row = handle.sqlite
      .prepare(`SELECT user_id, agent_id, status FROM memories WHERE id = 'mem_1'`)
      .get() as { user_id: string; agent_id: string; status: string };
    expect(row).toEqual({
      user_id: OWNER.userId,
      agent_id: OWNER.agentId,
      status: 'active',
    });
    handle.sqlite.close();
  });

  it('rejects an invalid memory type', () => {
    const handle = freshDb();
    expect(() => insertMemory(handle, { type: 'gossip' })).toThrow();
    handle.sqlite.close();
  });

  it('rejects an invalid status', () => {
    const handle = freshDb();
    expect(() => insertMemory(handle, { status: 'archived' })).toThrow();
    handle.sqlite.close();
  });

  it('rejects out-of-range confidence', () => {
    const handle = freshDb();
    expect(() => insertMemory(handle, { confidence: 1.5 })).toThrow();
    handle.sqlite.close();
  });

  it('rejects out-of-range arousal', () => {
    const handle = freshDb();
    expect(() => insertMemory(handle, { arousal: -0.1 })).toThrow();
    handle.sqlite.close();
  });

  it('rejects non-positive half life', () => {
    const handle = freshDb();
    expect(() => insertMemory(handle, { halfLifeHours: 0 })).toThrow();
    handle.sqlite.close();
  });

  it('rejects a memory referencing a nonexistent message', () => {
    const handle = freshDb();
    expect(() =>
      insertMemory(handle, { sourceMessageId: 'msg_missing' }),
    ).toThrow();
    handle.sqlite.close();
  });

  it('rejects duplicate content extracted from the same message (idempotency)', () => {
    const handle = freshDb();
    insertMemory(handle);
    fixtureMessage(handle, 'msg_1'); // already inserted; reuse row via second insert attempt
    expect(() => insertMemory(handle, { id: 'mem_2' })).toThrow();
    handle.sqlite.close();
  });

  it('restricts deleting a message that is a memory source', () => {
    const handle = freshDb();
    insertMemory(handle);
    expect(() =>
      handle.sqlite.prepare(`DELETE FROM messages WHERE id = 'msg_1'`).run(),
    ).toThrow();
    handle.sqlite.close();
  });
});

describe('conversation_summaries table constraints (S1)', () => {
  it('inserts a valid summary over a message range', () => {
    const handle = freshDb();
    fixtureMessage(handle, 'msg_start');
    fixtureMessage(handle, 'msg_end');
    expect(() =>
      handle.sqlite
        .prepare(
          `INSERT INTO conversation_summaries
             (id, conversation_id, agent_id, start_message_id, end_message_id,
              content, status, created_at, updated_at)
           VALUES ('sum_1', 'conv_1', '${OWNER.agentId}', 'msg_start', 'msg_end',
                   '用户在学做饭', 'ready', '${NOW}', '${NOW}')`,
        )
        .run(),
    ).not.toThrow();
    handle.sqlite.close();
  });

  it('rejects an invalid summary status', () => {
    const handle = freshDb();
    fixtureMessage(handle, 'msg_start');
    fixtureMessage(handle, 'msg_end');
    expect(() =>
      handle.sqlite
        .prepare(
          `INSERT INTO conversation_summaries
             (id, conversation_id, agent_id, start_message_id, end_message_id,
              content, status, created_at, updated_at)
           VALUES ('sum_1', 'conv_1', '${OWNER.agentId}', 'msg_start', 'msg_end',
                   '用户在学做饭', 'archived', '${NOW}', '${NOW}')`,
        )
        .run(),
    ).toThrow();
    handle.sqlite.close();
  });
});
