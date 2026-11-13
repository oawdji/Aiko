import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { stateTimelineRoute } from '../route';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-13T00:00:00.000Z';

let handle: DbHandle;

beforeAll(() => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'aiko-timeline-'));
  process.env.DATA_DIR = dataDir;
  handle = createDb(path.join(dataDir, 'agent.sqlite'));
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
  handle.sqlite
    .prepare(
      "INSERT OR IGNORE INTO conversations (id, user_id, agent_id, is_archived, created_at, updated_at) VALUES ('conv_t', 'local-user', 'agent-default', 0, ?, ?)",
    )
    .run(NOW, NOW);
  const insertEvent = handle.sqlite.prepare(
    `INSERT INTO state_events
       (id, agent_id, conversation_id, trigger_message_id, source, rule_version,
        before_valence, before_arousal, before_dominance, delta_valence, delta_arousal,
        delta_dominance, after_valence, after_arousal, after_dominance, discrete_tag,
        reason, evidence_text, confidence, created_at)
     VALUES (?, 'agent-default', 'conv_t', NULL, 'time_decay', 'emotion-rules-v2',
        0, 0, 0, -0.1, 0, 0, -0.1, 0, 0, 'low', '基线回归', '时间衰减', 0.9, ?)`,
  );
  for (let i = 0; i < 5; i++) {
    insertEvent.run(`state_t_${i}`, new Date(Date.parse(NOW) + i * 1000).toISOString());
  }
});

describe('GET /api/agents/:agentId/state/events', () => {
  it('returns newest-first page with mapped contract fields', async () => {
    const res = await stateTimelineRoute.request('/agents/agent-default/state/events?limit=3');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: string; evidenceText: string }>;
      nextPage: { beforeId: string; limit: number } | null;
    };
    expect(body.items).toHaveLength(3);
    expect(body.items[0]!.id).toBe('state_t_4');
    expect(body.items[0]!.evidenceText).toBe('时间衰减');
    expect(body.nextPage?.beforeId).toBe('state_t_2');
  });

  it('paginates with beforeId cursor', async () => {
    const res = await stateTimelineRoute.request(
      '/agents/agent-default/state/events?limit=10&beforeId=state_t_2',
    );
    const body = (await res.json()) as { items: Array<{ id: string }>; nextPage: null };
    expect(body.items.map((i) => i.id)).toEqual(['state_t_1', 'state_t_0']);
    expect(body.nextPage).toBeNull();
  });

  it('returns empty page for a cursor from another dataset', async () => {
    const res = await stateTimelineRoute.request(
      '/agents/agent-default/state/events?beforeId=state_missing',
    );
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  it('404s for an unknown agent and 400s for bad limit', async () => {
    const notFound = await stateTimelineRoute.request('/agents/agent-x/state/events');
    expect(notFound.status).toBe(404);
    expect(((await notFound.json()) as { code: string }).code).toBe('AGENT_NOT_FOUND');

    const badLimit = await stateTimelineRoute.request(
      '/agents/agent-default/state/events?limit=999',
    );
    expect(badLimit.status).toBe(400);
  });
});
