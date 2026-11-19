import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@aiko/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import { agents, conversations, stateEvents } from '../../db/schema';
import { stateTimelineRoute } from '../route';
import {
  AgentNotFoundError,
  ResetConversationNotFoundError,
  resetAgentState,
} from '../service';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-19T00:00:00.000Z';

let handle: DbHandle;

beforeAll(() => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'aiko-reset-'));
  process.env.DATA_DIR = dataDir;
  handle = createDb(path.join(dataDir, 'agent.sqlite'));
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
  handle.db.insert(conversations).values({
    id: 'conv_reset',
    userId: LOCAL_USER_ID,
    agentId: DEFAULT_AGENT_ID,
    title: null,
    lastMessageAt: null,
    isArchived: 0,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();
  // 把 agent 推离基线（负面 valence）
  handle.db.update(agents).set({
    currentValence: -0.6,
    currentArousal: 0.3,
    currentDominance: -0.1,
    currentTag: 'low',
    stateUpdatedAt: NOW,
    updatedAt: NOW,
  }).where(eq(agents.id, DEFAULT_AGENT_ID)).run();
});

describe('resetAgentState（服务层）', () => {
  it('重置回基线并写入 manual 状态事件', () => {
    const res = resetAgentState(handle, DEFAULT_AGENT_ID, 'conv_reset', NOW);
    expect(res.ok).toBe(true);
    expect(res.state).toEqual({ valence: 0, arousal: 0, dominance: 0 });
    expect(res.discreteTag).toBe('neutral');
    expect(res.event.source).toBe('manual');
    expect(res.event.before.valence).toBeCloseTo(-0.6, 5);
    expect(res.event.after.valence).toBe(0);
    expect(res.event.reason).toContain('基线');

    const agent = handle.db.select().from(agents).where(eq(agents.id, DEFAULT_AGENT_ID)).get()!;
    expect(agent.currentValence).toBe(0);
    expect(agent.currentArousal).toBe(0);
    expect(agent.currentDominance).toBe(0);
    expect(agent.currentTag).toBe('neutral');
    expect(agent.stateUpdatedAt).toBe(NOW);

    const event = handle.db.select().from(stateEvents)
      .where(eq(stateEvents.id, res.event.id)).get()!;
    expect(event.source).toBe('manual');
    expect(event.triggerMessageId).toBeNull();
    expect(event.ruleVersion).toBe('manual-reset-v1');
    expect(event.conversationId).toBe('conv_reset');
  });

  it('重复重置（已在基线）也成功，delta 为 0', () => {
    const res = resetAgentState(handle, DEFAULT_AGENT_ID, 'conv_reset', NOW);
    expect(res.event.delta.valence).toBe(0);
    expect(res.state.valence).toBe(0);
  });

  it('未知 agent → AgentNotFoundError', () => {
    expect(() =>
      resetAgentState(handle, 'agent_none', 'conv_reset', NOW),
    ).toThrow(AgentNotFoundError);
  });

  it('未知会话 → ResetConversationNotFoundError', () => {
    expect(() =>
      resetAgentState(handle, DEFAULT_AGENT_ID, 'conv_none', NOW),
    ).toThrow(ResetConversationNotFoundError);
  });
});

describe('路由：POST /api/agents/:id/state/reset', () => {
  it('200 + 响应契约', async () => {
    const res = await stateTimelineRoute.request('/agents/' + DEFAULT_AGENT_ID + '/state/reset', {
      method: 'POST',
      body: JSON.stringify({ conversationId: 'conv_reset' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; event: { source: string }; state: { valence: number } };
    expect(body.ok).toBe(true);
    expect(body.event.source).toBe('manual');
    expect(body.state.valence).toBe(0);
  });

  it('缺少 conversationId → 400', async () => {
    const res = await stateTimelineRoute.request('/agents/' + DEFAULT_AGENT_ID + '/state/reset', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('未知 agent → 404 AGENT_NOT_FOUND', async () => {
    const res = await stateTimelineRoute.request('/agents/agent_none/state/reset', {
      method: 'POST',
      body: JSON.stringify({ conversationId: 'conv_reset' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('AGENT_NOT_FOUND');
  });
});