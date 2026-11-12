import { and, desc, eq, sql } from 'drizzle-orm';
import {
  MESSAGE_PAGE_LIMIT_DEFAULT,
  MESSAGE_PAGE_LIMIT_MAX,
  ConversationDetailResponseSchema,
  type ConversationDetailResponse,
} from '@aiko/shared';
import type { DbHandle } from '../db/client';
import {
  mapAgentRow,
  mapConversationRow,
  mapMessageRow,
  mapStateEventRow,
} from '../db/mappers';
import { agents, conversations, messages, stateEvents } from '../db/schema';

export { MESSAGE_PAGE_LIMIT_MAX };

export type ConversationPageQuery = {
  limit?: number;
  beforeId?: string;
};

export class ConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`Conversation not found: ${conversationId}`);
    this.name = 'ConversationNotFoundError';
  }
}

export class CursorMessageNotFoundError extends Error {
  constructor(conversationId: string, beforeId: string) {
    super(`Cursor message ${beforeId} not found in conversation ${conversationId}`);
    this.name = 'CursorMessageNotFoundError';
  }
}

/**
 * M2.3 会话详情 + 游标分页领域服务（api-contract.md §8）：
 * - 倒序查询（利用 messages_conversation_created_idx），返回前反转为升序；
 * - beforeId 游标 = 上一页最旧消息 ID，用 (created_at, id) 行值比较保证同毫秒稳定；
 * - 多取 1 条探测是否有更旧数据，避免客户端猜测 nextPage；
 * - latestStateEvent 按 Agent 查询（不限当前会话），保持状态连续性。
 */
export function getConversationDetail(
  handle: DbHandle,
  conversationId: string,
  query: ConversationPageQuery = {},
): ConversationDetailResponse {
  const { db } = handle;
  const limit = query.limit ?? MESSAGE_PAGE_LIMIT_DEFAULT;

  if (!Number.isInteger(limit) || limit < 1 || limit > MESSAGE_PAGE_LIMIT_MAX) {
    throw new RangeError(`limit must be an integer in [1, ${MESSAGE_PAGE_LIMIT_MAX}]`);
  }

  const conversation = db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .get();
  if (!conversation) {
    throw new ConversationNotFoundError(conversationId);
  }

  const agent = db
    .select()
    .from(agents)
    .where(eq(agents.id, conversation.agentId))
    .get();
  if (!agent) {
    // 外键 restrict 保证存在会话必存在 Agent；此处仅作防御。
    throw new ConversationNotFoundError(conversationId);
  }

  // 解析游标：beforeId 必须属于当前会话，防止跨会话游标注入。
  let cursor: { createdAt: string; id: string } | null = null;
  if (query.beforeId !== undefined) {
    const cursorRow = db
      .select({ createdAt: messages.createdAt, id: messages.id })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.id, query.beforeId)))
      .get();
    if (!cursorRow) {
      throw new CursorMessageNotFoundError(conversationId, query.beforeId);
    }
    cursor = cursorRow;
  }

  const pageFilter = cursor
    ? and(
        eq(messages.conversationId, conversationId),
        sql`(${messages.createdAt}, ${messages.id}) < (${cursor.createdAt}, ${cursor.id})`,
      )
    : eq(messages.conversationId, conversationId);

  // 多取 1 条判断 nextPage；返回给前端前反转为升序。
  const pageRows = db
    .select()
    .from(messages)
    .where(pageFilter)
    .orderBy(desc(messages.createdAt), sql`rowid DESC`)
    .limit(limit + 1)
    .all();

  const hasMore = pageRows.length > limit;
  const visibleRows = pageRows.slice(0, limit).reverse();

  const latestStateEvent = db
    .select()
    .from(stateEvents)
    .where(eq(stateEvents.agentId, agent.id))
    .orderBy(desc(stateEvents.createdAt), desc(stateEvents.id))
    .get();

  const oldestVisible = visibleRows.at(0);

  return ConversationDetailResponseSchema.parse({
    conversation: mapConversationRow(conversation),
    agent: mapAgentRow(agent),
    messages: visibleRows.map(mapMessageRow),
    latestStateEvent: latestStateEvent ? mapStateEventRow(latestStateEvent) : null,
    nextPage:
      hasMore && oldestVisible
        ? { limit, beforeId: oldestVisible.id }
        : null,
  });
}