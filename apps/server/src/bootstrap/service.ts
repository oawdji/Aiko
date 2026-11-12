import { randomUUID } from 'node:crypto';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import {
  LOCAL_USER_ID,
  BootstrapResponseSchema,
  type BootstrapResponse,
} from '@aiko/shared';
import type { DbHandle } from '../db/client';
import {
  mapAgentRow,
  mapConversationRow,
  mapMessageRow,
  mapStateEventRow,
} from '../db/mappers';
import { agents, conversations, messages, stateEvents } from '../db/schema';
import { readAppSettings } from '../settings/service';
import { computeDisplayState } from '../chat/emotion-decay';

/** Bootstrap 恢复的消息窗口，见 api-contract.md §7.5。 */
export const BOOTSTRAP_MESSAGE_LIMIT = 30;

export class AgentNotFoundError extends Error {
  constructor(agentRef: string) {
    super(`Agent not found: ${agentRef}`);
    this.name = 'AgentNotFoundError';
  }
}

/**
 * M2.2 Bootstrap 领域服务：
 * - 读取或创建最近活跃会话（活跃 = 未归档，按 lastMessageAt/updatedAt 取最新）；
 * - 返回最近 30 条消息（升序）；
 * - 返回 Agent 最新一条状态事件（同毫秒按 id 倒序稳定排序）；
 * - 返回本地设置。
 * route 层只做参数解析与错误映射，不接触 SQL；本层不做 HTTP 概念。
 */
export function bootstrapAgent(handle: DbHandle, agentRef: string, now: string): BootstrapResponse {
  const { db } = handle;

  const agent = db
    .select()
    .from(agents)
    .where(or(eq(agents.slug, agentRef), eq(agents.id, agentRef)))
    .get();
  if (!agent) {
    throw new AgentNotFoundError(agentRef);
  }

  let conversation = db
    .select()
    .from(conversations)
    .where(and(eq(conversations.agentId, agent.id), eq(conversations.isArchived, 0)))
    .orderBy(sql`COALESCE(${conversations.lastMessageAt}, ${conversations.updatedAt}) DESC`, desc(conversations.id))
    .get();

  if (!conversation) {
    db.insert(conversations)
      .values({
        id: `conv_${randomUUID()}`,
        userId: LOCAL_USER_ID,
        agentId: agent.id,
        title: null,
        lastMessageAt: null,
        isArchived: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    conversation = db
      .select()
      .from(conversations)
      .where(and(eq(conversations.agentId, agent.id), eq(conversations.isArchived, 0)))
      .orderBy(sql`COALESCE(${conversations.lastMessageAt}, ${conversations.updatedAt}) DESC`, desc(conversations.id))
      .get();
  }

  if (!conversation) {
    throw new Error('bootstrap: conversation disappeared after creation');
  }

  // 倒序取最近窗口后反转为升序，利用 messages_conversation_created_idx。
  const recentMessages = db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversation.id))
    .orderBy(desc(messages.createdAt), sql`rowid DESC`)
    .limit(BOOTSTRAP_MESSAGE_LIMIT)
    .all()
    .reverse();

  const latestStateEvent = db
    .select()
    .from(stateEvents)
    .where(eq(stateEvents.agentId, agent.id))
    .orderBy(desc(stateEvents.createdAt), desc(stateEvents.id))
    .get();

  return BootstrapResponseSchema.parse({
    user: { id: LOCAL_USER_ID },
    // 读时回归：展示态随时间回归基线，但不写库（§10.11）
    agent: mapAgentRow(agent, computeDisplayState(agent, now)),
    conversation: mapConversationRow(conversation),
    messages: recentMessages.map(mapMessageRow),
    latestStateEvent: latestStateEvent ? mapStateEventRow(latestStateEvent) : null,
    settings: readAppSettings(handle),
  });
}

