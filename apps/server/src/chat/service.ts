import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { LOCAL_USER_ID, type ChatRequestBody } from '@aiko/shared';
import type { DbHandle } from '../db/client';
import { agents, conversations, messages } from '../db/schema';

export class ChatAgentNotFoundError extends Error {
  constructor(agentRef: string) {
    super(`Agent not found: ${agentRef}`);
    this.name = 'ChatAgentNotFoundError';
  }
}

export class ChatConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`Conversation not found or not owned by agent: ${conversationId}`);
    this.name = 'ChatConversationNotFoundError';
  }
}

export class DuplicateClientMessageError extends Error {
  readonly existingMessageId: string;

  constructor(existingMessageId: string) {
    super('This message has already been submitted.');
    this.name = 'DuplicateClientMessageError';
    this.existingMessageId = existingMessageId;
  }
}

export class ChatPipelineNotImplementedError extends Error {
  constructor() {
    super('LLM streaming not implemented yet (M3.4)');
    this.name = 'ChatPipelineNotImplementedError';
  }
}

export type PersistedUserMessage = {
  messageId: string;
  conversationId: string;
  agentId: string;
};

function findExistingMessage(
  handle: DbHandle,
  conversationId: string,
  clientMessageId: string,
): { id: string } | undefined {
  return handle.db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.clientMessageId, clientMessageId),
      ),
    )
    .get();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

/**
 * M3.2：校验 Agent/会话归属 → 事务写入用户消息（幂等）→ 更新会话活跃时间。
 * 幂等依赖 messages_conversation_client_message_unique 数据库约束兜底：
 * 应用层做「预查（拿 existingMessageId）+ 捕获唯一约束冲突」两道防线。
 */
export function persistUserMessage(
  handle: DbHandle,
  body: ChatRequestBody,
  now: string,
): PersistedUserMessage {
  const { db } = handle;

  const agent =
    db.select().from(agents).where(eq(agents.id, body.agentId)).get() ??
    db.select().from(agents).where(eq(agents.slug, body.agentId)).get();
  if (!agent) {
    throw new ChatAgentNotFoundError(body.agentId);
  }

  const conversation = db
    .select()
    .from(conversations)
    .where(eq(conversations.id, body.conversationId))
    .get();
  if (!conversation || conversation.agentId !== agent.id) {
    throw new ChatConversationNotFoundError(body.conversationId);
  }

  const existing = findExistingMessage(handle, conversation.id, body.clientMessageId);
  if (existing) {
    throw new DuplicateClientMessageError(existing.id);
  }

  const messageId = `msg_${randomUUID()}`;
  try {
    handle.sqlite.transaction(() => {
      db.insert(messages)
        .values({
          id: messageId,
          conversationId: conversation.id,
          agentId: agent.id,
          userId: LOCAL_USER_ID,
          role: 'user',
          content: body.message,
          status: 'complete',
          clientMessageId: body.clientMessageId,
          errorCode: null,
          metadataJson: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      db.update(conversations)
        .set({ lastMessageAt: now, updatedAt: now })
        .where(eq(conversations.id, conversation.id))
        .run();
    })();
  } catch (error) {
    // 并发窗口兜底：唯一约束冲突说明同一 clientMessageId 已入库。
    if (isUniqueViolation(error)) {
      const row = findExistingMessage(handle, conversation.id, body.clientMessageId);
      throw new DuplicateClientMessageError(row?.id ?? messageId);
    }
    throw error;
  }

  return { messageId, conversationId: conversation.id, agentId: agent.id };
}

/**
 * 聊天编排入口：M3.2 完成用户消息持久化，M3.4 在此之后接入
 * 情绪规则 → Prompt 组装 → LLM 流式 → assistant 落库。
 */
export async function handleChatRequest(
  deps: { body: ChatRequestBody },
  handle: DbHandle,
  now: string,
): Promise<never> {
  persistUserMessage(handle, deps.body, now);
  throw new ChatPipelineNotImplementedError();
}