import { randomUUID } from 'node:crypto';
import { and, desc, eq, lt } from 'drizzle-orm';
import {
  AgentStateResetResponseSchema,
  AgentStateEventSchema,
  StateEventPageResponseSchema,
  type AgentStateResetResponse,
  type StateEventPageResponse,
} from '@aiko/shared';
import type { DbHandle } from '../db/client';
import { agents, conversations, stateEvents } from '../db/schema';
import { revertToBaseline, resolveDecayConfig } from '../chat/emotion-decay';
import { computeTag } from '../chat/emotion-llm';
import { ConversationNotFoundError } from '../conversations/service';

/** 重置时指定的会话不存在（state_events 外键要求） */
export class ResetConversationNotFoundError extends ConversationNotFoundError {}

export class AgentNotFoundError extends Error {
  constructor(agentId: string) {
    super(`Agent "${agentId}" not found`);
    this.name = 'AgentNotFoundError';
  }
}

const PAGE_LIMIT_MAX = 200;

/** 状态事件分页（beforeId 游标），按 created_at desc 排列，供状态时间线（F11）。 */
export function getStateEventPage(
  handle: DbHandle,
  agentId: string,
  rawLimit: number | undefined,
  beforeId?: string,
): StateEventPageResponse {
  const limit = Math.min(Math.max(rawLimit ?? 50, 1), PAGE_LIMIT_MAX);

  const agent = handle.db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, agentId))
    .get();
  if (!agent) throw new AgentNotFoundError(agentId);

  const conditions = [eq(stateEvents.agentId, agentId)];
  if (beforeId) {
    const cursor = handle.db
      .select({ createdAt: stateEvents.createdAt })
      .from(stateEvents)
      .where(eq(stateEvents.id, beforeId))
      .get();
    if (!cursor) {
      // 游标不属于该 agent 的数据集，返回空页
      return StateEventPageResponseSchema.parse({ items: [], nextPage: null });
    }
    conditions.push(lt(stateEvents.createdAt, cursor.createdAt));
  }

  const items = handle.db
    .select()
    .from(stateEvents)
    .where(and(...conditions))
    .orderBy(desc(stateEvents.createdAt))
    .limit(limit + 1)
    .all();

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return StateEventPageResponseSchema.parse({
    items: page.map((row) => ({
      id: row.id,
      agentId: row.agentId,
      conversationId: row.conversationId,
      triggerMessageId: row.triggerMessageId,
      source: row.source,
      ruleVersion: row.ruleVersion,
      before: {
        valence: row.beforeValence,
        arousal: row.beforeArousal,
        dominance: row.beforeDominance,
      },
      delta: {
        valence: row.deltaValence,
        arousal: row.deltaArousal,
        dominance: row.deltaDominance,
      },
      after: {
        valence: row.afterValence,
        arousal: row.afterArousal,
        dominance: row.afterDominance,
      },
      discreteTag: row.discreteTag,
      reason: row.reason,
      evidenceText: row.evidenceText,
      confidence: row.confidence,
      createdAt: row.createdAt,
    })),
    nextPage: hasMore ? { beforeId: page[page.length - 1]!.id, limit } : null,
  });
}

/**
 * 手动重置情绪回气质基线（透明性/可修正性补全）：
 * - before 取读时回归后的展示态（与 applyStateEvent 同口径）；
 * - after 即角色基线；写入 source='manual' 的状态事件保证可追溯；
 * - conversationId 必须存在（state_events 外键 restrict）。
 */
export function resetAgentState(
  handle: DbHandle,
  agentId: string,
  conversationId: string,
  now: string,
): AgentStateResetResponse {
  const agent = handle.db.select().from(agents).where(eq(agents.id, agentId)).get();
  if (!agent) {
    throw new AgentNotFoundError(agentId);
  }
  const conversation = handle.db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .get();
  if (!conversation) {
    throw new ResetConversationNotFoundError(conversationId);
  }

  const elapsedHours = agent.stateUpdatedAt
    ? (Date.parse(now) - Date.parse(agent.stateUpdatedAt)) / 3_600_000
    : 0;
  const before = revertToBaseline(
    {
      valence: agent.currentValence,
      arousal: agent.currentArousal,
      dominance: agent.currentDominance,
    },
    {
      valence: agent.baselineValence,
      arousal: agent.baselineArousal,
      dominance: agent.baselineDominance,
    },
    elapsedHours,
    resolveDecayConfig(agent.decayHalfLifeHours),
  );
  const after = {
    valence: agent.baselineValence,
    arousal: agent.baselineArousal,
    dominance: agent.baselineDominance,
  };
  const delta = {
    valence: after.valence - before.valence,
    arousal: after.arousal - before.arousal,
    dominance: after.dominance - before.dominance,
  };
  const tag = computeTag(after);
  const eventId = `state_${randomUUID()}`;

  handle.sqlite.transaction(() => {
    handle.db.insert(stateEvents).values({
      id: eventId,
      agentId,
      conversationId,
      triggerMessageId: null,
      source: 'manual',
      ruleVersion: 'manual-reset-v1',
      beforeValence: before.valence,
      beforeArousal: before.arousal,
      beforeDominance: before.dominance,
      deltaValence: delta.valence,
      deltaArousal: delta.arousal,
      deltaDominance: delta.dominance,
      afterValence: after.valence,
      afterArousal: after.arousal,
      afterDominance: after.dominance,
      discreteTag: tag,
      reason: '手动重置回气质基线',
      evidenceText: '用户在状态面板手动触发重置',
      confidence: 1,
      createdAt: now,
    }).run();

    handle.db.update(agents).set({
      currentValence: after.valence,
      currentArousal: after.arousal,
      currentDominance: after.dominance,
      currentTag: tag,
      stateUpdatedAt: now,
      updatedAt: now,
    }).where(eq(agents.id, agentId)).run();
  })();

  return AgentStateResetResponseSchema.parse({
    ok: true,
    agentId,
    state: after,
    discreteTag: tag,
    stateUpdatedAt: now,
    event: AgentStateEventSchema.parse({
      id: eventId,
      agentId,
      conversationId,
      triggerMessageId: null,
      source: 'manual',
      ruleVersion: 'manual-reset-v1',
      before,
      delta,
      after,
      discreteTag: tag,
      reason: '手动重置回气质基线',
      evidenceText: '用户在状态面板手动触发重置',
      confidence: 1,
      createdAt: now,
    }),
  });
}