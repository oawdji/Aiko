import { and, desc, eq, lt } from 'drizzle-orm';
import { StateEventPageResponseSchema, type StateEventPageResponse } from '@aiko/shared';
import type { DbHandle } from '../db/client';
import { agents, stateEvents } from '../db/schema';

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
