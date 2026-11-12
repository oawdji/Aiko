import { Hono } from 'hono';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  ChatRequestBodySchema,
  type ApiError,
} from '@aiko/shared';
import { getDb } from '../db';
import {
  ChatAgentNotFoundError,
  ChatConversationNotFoundError,
  DuplicateClientMessageError,
  handleChatRequest,
} from './service';

/** 普通 JSON 请求体大小上限（api-contract.md §3.2：聊天 ≤ 128KB）。 */
const CHAT_BODY_MAX_BYTES = 128 * 1024;

/**
 * POST /api/chat（M3.1 校验 + M3.2 错误映射）：
 * route 层只负责校验与错误码映射，编排逻辑全部在 chat service。
 */
export const chatRoute = new Hono().post('/chat', async (c) => {
  const contentLength = Number(c.req.header('content-length') ?? '0');
  if (contentLength > CHAT_BODY_MAX_BYTES) {
    const body: ApiError = {
      code: 'MESSAGE_TOO_LONG',
      message: 'Request body exceeds 128 KB',
    };
    return c.json(body, 413);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    const body: ApiError = {
      code: 'INVALID_REQUEST',
      message: 'Request body must be valid JSON',
    };
    return c.json(body, 400);
  }

  const parsed = ChatRequestBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    const messageTooLong = parsed.error.issues.some(
      (issue) => issue.path[0] === 'message' && issue.message.includes('at most'),
    );
    const body: ApiError = {
      code: messageTooLong ? 'MESSAGE_TOO_LONG' : 'INVALID_REQUEST',
      message: messageTooLong
        ? `message must be at most ${CHAT_MESSAGE_MAX_LENGTH} characters`
        : 'Validation failed',
      details: parsed.error.flatten().fieldErrors,
    };
    return c.json(body, messageTooLong ? 413 : 400);
  }

  try {
    return await handleChatRequest(
      { body: parsed.data },
      getDb(),
      new Date().toISOString(),
    );
  } catch (error) {
    if (error instanceof DuplicateClientMessageError) {
      const body: ApiError & { details?: { existingMessageId: string } } = {
        code: 'DUPLICATE_CLIENT_MESSAGE',
        message: error.message,
        details: { existingMessageId: error.existingMessageId },
      };
      return c.json(body, 409);
    }
    if (error instanceof ChatAgentNotFoundError) {
      const body: ApiError = {
        code: 'AGENT_NOT_FOUND',
        message: error.message,
      };
      return c.json(body, 404);
    }
    if (error instanceof ChatConversationNotFoundError) {
      const body: ApiError = {
        code: 'CONVERSATION_NOT_FOUND',
        message: error.message,
      };
      return c.json(body, 404);
    }
    const body: ApiError = {
      code: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Chat pipeline failed',
    };
    return c.json(body, 500);
  }
});