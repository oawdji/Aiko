import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  MESSAGE_PAGE_LIMIT_DEFAULT,
  MESSAGE_PAGE_LIMIT_MAX,
  ConversationDetailResponseSchema,
  ConversationListResponseSchema,
  type ConversationDetailResponse,
  type ConversationListResponse,
} from '@aiko/shared';
import { LOCAL_USER_ID, type ConversationDTO } from '@aiko/shared';
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

const PREVIEW_MAX = 80;

function toPreview(content: string | null | undefined): string | null {
  if (!content) return null;
  const flat = content.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX)}…` : flat;
}

/**
 * 历史记录列表：未归档会话按最近活动倒序。
 * preview 取该会话第一条用户消息，用作侧栏标题。
 */
export function listConversations(handle: DbHandle, agentId?: string): ConversationListResponse {
  const { db } = handle;
  const filter = agentId
    ? and(eq(conversations.agentId, agentId), eq(conversations.isArchived, 0))
    : eq(conversations.isArchived, 0);

  const rows = db
    .select()
    .from(conversations)
    .where(filter)
    .orderBy(
      sql`COALESCE(${conversations.lastMessageAt}, ${conversations.updatedAt}) DESC`,
      desc(conversations.id),
    )
    .all();

  const items = rows.map((row) => {
    const firstUser = db
      .select({ content: messages.content })
      .from(messages)
      .where(and(eq(messages.conversationId, row.id), eq(messages.role, 'user')))
      .orderBy(messages.createdAt, sql`rowid ASC`)
      .get();
    return {
      ...mapConversationRow(row),
      preview: toPreview(firstUser?.content),
    };
  });

  return ConversationListResponseSchema.parse({ items });
}

export class ConversationAgentNotFoundError extends Error {
  constructor(agentId: string) {
    super(`Agent not found: ${agentId}`);
    this.name = 'ConversationAgentNotFoundError';
  }
}

/**
 * 手动新建会话：创建一个空白会话并立即返回 DTO。
 * 新会话按 lastMessageAt/updatedAt 排序位于历史列表最前（见 listConversations 排序口径）。
 */
export function createConversation(
  handle: DbHandle,
  agentId: string,
  now: string,
): ConversationDTO {
  const agent = handle.db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, agentId))
    .get();
  if (!agent) {
    throw new ConversationAgentNotFoundError(agentId);
  }
  const id = `conv_${randomUUID()}`;
  handle.db
    .insert(conversations)
    .values({
      id,
      userId: LOCAL_USER_ID,
      agentId,
      title: null,
      lastMessageAt: null,
      isArchived: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const row = handle.db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .get();
  if (!row) {
    throw new Error('createConversation: conversation disappeared after insert');
  }
  return mapConversationRow(row);
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
export type DeleteConversationsResult = {
  deletedAt: string;
  count: number;
};

function deleteConversationRows(handle: DbHandle, conversationId: string): void {
  // 顺序：RESTRICT 外键的子表先行；prompt_snapshots 随会话级联删除
  handle.sqlite.prepare('DELETE FROM state_events WHERE conversation_id = ?').run(conversationId);
  handle.sqlite.prepare('DELETE FROM conversation_summaries WHERE conversation_id = ?').run(conversationId);
  handle.sqlite.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
  handle.sqlite.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
}

/**
 * 删除单个会话（F18 数据控制延伸）：
 * - 移除消息、状态事件、会话摘要与 Prompt 快照；
 * - 长期记忆保留，其来源链接由 FK ON DELETE SET NULL 自动解除；
 * - 该会话的语义向量切片暂不清理（向量库无会话维度），清空全部时统一清理。
 */
export function deleteConversation(
  handle: DbHandle,
  conversationId: string,
): DeleteConversationsResult {
  const exists = handle.db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .get();
  if (!exists) {
    throw new ConversationNotFoundError(conversationId);
  }
  handle.sqlite.transaction(() => deleteConversationRows(handle, conversationId))();
  return { deletedAt: new Date().toISOString(), count: 1 };
}

/** 清空全部会话。长期记忆保留；语义向量库由 route 层异步清空。 */
export function clearConversations(handle: DbHandle): DeleteConversationsResult {
  const count = (
    handle.sqlite.prepare('SELECT COUNT(*) AS n FROM conversations').get() as {
      n: number;
    }
  ).n;
  handle.sqlite.transaction(() => {
    handle.sqlite.prepare('DELETE FROM state_events').run();
    handle.sqlite.prepare('DELETE FROM conversation_summaries').run();
    handle.sqlite.prepare('DELETE FROM messages').run();
    handle.sqlite.prepare('DELETE FROM conversations').run();
  })();
  return { deletedAt: new Date().toISOString(), count };
}
