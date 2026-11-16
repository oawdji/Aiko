import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@aiko/shared';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { createUIMessageStream } from 'ai';
import type { ChatRequestBody } from '@aiko/shared';
import { runChatPipeline, type LlmStreamHandle } from '../../chat/service';
import { ensureMemorySearchIndex, normalizeForFts } from '../search-index';
import {
  RETRIEVAL_WEIGHTS,
  scoreAffective,
  scoreRecency,
  scoreSemantic,
  searchMemories,
  updateLastAccessed,
} from '../retrieval';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-13T00:00:00.000Z';
const OWNER = { userId: LOCAL_USER_ID, agentId: DEFAULT_AGENT_ID };

let handle: DbHandle;

function addMemory(
  id: string,
  content: string,
  opts: {
    pad?: { v: number; a: number; d: number };
    ageHours?: number;
    status?: string;
    type?: string;
  } = {},
): void {
  const pad = opts.pad ?? { v: 0, a: 0, d: 0 };
  const createdAt = new Date(Date.parse(NOW) - (opts.ageHours ?? 0) * 3_600_000).toISOString();
  handle.sqlite
    .prepare(
      'INSERT OR IGNORE INTO memories (id, user_id, agent_id, type, content, source_message_id, confidence, status, memory_pad, arousal, half_life_hours, strength, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      OWNER.userId,
      OWNER.agentId,
      opts.type ?? 'fact',
      content,
      'msg_src',
      0.9,
      opts.status ?? 'active',
      JSON.stringify(pad),
      Math.max(0, pad.a),
      72,
      1,
      createdAt,
      createdAt,
    );
  handle.sqlite
    .prepare('INSERT INTO memories_fts (content, memory_id) VALUES (?, ?)')
    .run(normalizeForFts(content), id);
}

beforeAll(() => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'aiko-retrieval-')), 'agent.sqlite');
  handle = createDb(dbPath);
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
  ensureMemorySearchIndex(handle);

  handle.sqlite
    .prepare(
      "INSERT OR IGNORE INTO conversations (id, user_id, agent_id, is_archived, created_at, updated_at) VALUES ('conv_r', ?, ?, 0, ?, ?)",
    )
    .run(OWNER.userId, OWNER.agentId, NOW, NOW);
  const insertMsg = handle.sqlite.prepare(
    "INSERT OR IGNORE INTO messages (id, conversation_id, agent_id, user_id, role, content, status, client_message_id, created_at, updated_at) VALUES (?, 'conv_r', ?, ?, 'user', 'x', 'complete', ?, ?, ?)",
  );
  ['msg_r_1', 'msg_r_2', 'msg_r_3'].forEach((id, i) =>
    insertMsg.run(id, DEFAULT_AGENT_ID, LOCAL_USER_ID, `client_r_${i}`, NOW, NOW),
  );

  insertMsg.run('msg_src', DEFAULT_AGENT_ID, LOCAL_USER_ID, 'client_r_src', NOW, NOW);

  addMemory('mem_r_cook', '用户正在学做饭', { pad: { v: -0.3, a: 0.4, d: 0 }, ageHours: 1 });
  addMemory('mem_r_sh', '用户住在上海', { pad: { v: 0, a: 0, d: 0 }, ageHours: 100 });
  addMemory('mem_r_old', '用户正在学做饭进阶课程与烘焙甜品', { pad: { v: 0, a: 0, d: 0 }, ageHours: 400, status: 'outdated' });
  addMemory('mem_r_cand', '用户做饭很好吃', { status: 'candidate' });
});

describe('scoring functions', () => {
  it('semantic maps bm25 rank to [0,1)', () => {
    expect(scoreSemantic(null)).toBe(0);
    expect(scoreSemantic(0)).toBe(1);
    expect(scoreSemantic(-2)).toBeLessThan(scoreSemantic(-0.5));
  });

  it('affective is 0 without current pad, equal-weight consistency otherwise', () => {
    expect(scoreAffective(null, { v: 0, a: 0, d: 0 })).toBe(0);
    const full = scoreAffective({ v: 0.2, a: 0.1, d: 0 }, { v: 0.2, a: 0.1, d: 0 });
    expect(full).toBe(1);
    const half = scoreAffective({ v: 1, a: 0, d: 0 }, { v: -1, a: 0, d: 0 });
    expect(half).toBeCloseTo(2 / 3);
  });

  it('recency decays exponentially with half life', () => {
    expect(scoreRecency(NOW, NOW, 72)).toBe(1);
    const half = scoreRecency(new Date(Date.parse(NOW) - 72 * 3600_000).toISOString(), NOW, 72);
    expect(half).toBeCloseTo(0.5);
  });

  it('weights satisfy beta < alpha', () => {
    expect(RETRIEVAL_WEIGHTS.beta).toBeLessThan(RETRIEVAL_WEIGHTS.alpha);
  });
});

describe('searchMemories integration', () => {
  it('ranks semantically matching active memories and excludes candidate/outdated', () => {
    const hits = searchMemories(handle, {
      owner: OWNER,
      queryText: '做饭',
      currentPad: { v: -0.3, a: 0.4, d: 0 },
      nowIso: NOW,
    });
    const ids = hits.map((h) => h.id);
    expect(ids).toContain('mem_r_cook');
    expect(ids).not.toContain('mem_r_old');
    expect(ids).not.toContain('mem_r_cand');
    expect(hits[0]!.id).toBe('mem_r_cook');
  });

  it('enforces owner scoping', () => {
    const hits = searchMemories(
      handle,
      {
        owner: { userId: 'someone-else', agentId: DEFAULT_AGENT_ID },
        queryText: '做饭',
        currentPad: null,
        nowIso: NOW,
      },
    );
    expect(hits).toEqual([]);
  });

  it('returns empty for blank or operator-only queries', () => {
    expect(
      searchMemories(handle, { owner: OWNER, queryText: '   ', currentPad: null, nowIso: NOW }),
    ).toEqual([]);
    expect(
      searchMemories(handle, { owner: OWNER, queryText: 'AND OR NOT', currentPad: null, nowIso: NOW }),
    ).toEqual([]);
  });

  it('updateLastAccessed writes the timestamp', () => {
    updateLastAccessed(handle, ['mem_r_cook'], NOW);
    const row = handle.sqlite
      .prepare('SELECT last_accessed_at FROM memories WHERE id = ?')
      .get('mem_r_cook') as { last_accessed_at: string };
    expect(row.last_accessed_at).toBe(NOW);
  });
});

describe('prompt injection (S3c end-to-end)', () => {
  it('injects top-k active memories into the system prompt', async () => {
    let capturedSystem = "";
    const factory = (prompt: { system: string }) => {
      capturedSystem = prompt.system;
      const stream = createUIMessageStream({
        execute: ({ writer }) => {
          writer.write({ type: 'text-delta', id: 'fake', delta: 'ok' });
        },
      });
      return { text: Promise.resolve('ok'), toUimessageStream: () => stream as never } as LlmStreamHandle;
    };
    const body: ChatRequestBody = {
      agentId: DEFAULT_AGENT_ID,
      conversationId: 'conv_r',
      message: '我做的饭怎么样了',
      clientMessageId: 'client_inject_1',
    };
    const pipeline = await runChatPipeline(handle, body, NOW, factory);
    await pipeline.memoryExtraction;
    expect(capturedSystem).toContain('关于用户的长期记忆');
    expect(capturedSystem).toContain('用户正在学做饭');
  });
});
