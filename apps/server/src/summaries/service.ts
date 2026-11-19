import { and, desc, eq } from 'drizzle-orm';
import {
  SummaryListResponseSchema,
  type SummaryListResponse,
} from '@aiko/shared';
import type { DbHandle } from '../db/client';
import { conversationSummaries } from '../db/schema';

/**
 * 会话摘要查询与删除（透明性补全：摘要此前只注入 prompt，用户不可见）。
 * - 列表只返回 status='ready' 的摘要（pending/failed/deleted 不对外）；
 * - 删除为软删除（status='deleted'），保持 start/end 消息 RESTRICT 外键完整；
 *   已删除的摘要不会再注入 prompt（loadInjectableSummaries 只取 ready）。
 */

export class SummaryNotFoundError extends Error {
  constructor(id: string) {
    super(`Summary not found: ${id}`);
    this.name = 'SummaryNotFoundError';
  }
}

export type SummaryListQuery = {
  conversationId?: string;
  limit?: number;
  offset?: number;
};

export function listSummaries(
  handle: DbHandle,
  query: SummaryListQuery = {},
): SummaryListResponse {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const filter = query.conversationId
    ? and(
        eq(conversationSummaries.status, 'ready'),
        eq(conversationSummaries.conversationId, query.conversationId),
      )
    : eq(conversationSummaries.status, 'ready');

  const rows = handle.db
    .select({
      id: conversationSummaries.id,
      conversationId: conversationSummaries.conversationId,
      agentId: conversationSummaries.agentId,
      startMessageId: conversationSummaries.startMessageId,
      endMessageId: conversationSummaries.endMessageId,
      content: conversationSummaries.content,
      status: conversationSummaries.status,
      createdAt: conversationSummaries.createdAt,
      updatedAt: conversationSummaries.updatedAt,
    })
    .from(conversationSummaries)
    .where(filter)
    .orderBy(desc(conversationSummaries.createdAt))
    .all();

  const total = rows.length;
  const items = rows.slice(offset, offset + limit);
  return SummaryListResponseSchema.parse({
    items,
    total,
  });
}

export function deleteSummary(handle: DbHandle, id: string, now: string): { ok: true; deletedAt: string } {
  const row = handle.db
    .select()
    .from(conversationSummaries)
    .where(eq(conversationSummaries.id, id))
    .get();
  if (!row || row.status !== 'ready') {
    throw new SummaryNotFoundError(id);
  }
  handle.db
    .update(conversationSummaries)
    .set({ status: 'deleted', updatedAt: now })
    .where(eq(conversationSummaries.id, id))
    .run();
  return { ok: true, deletedAt: now };
}