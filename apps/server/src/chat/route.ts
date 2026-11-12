import { Hono } from 'hono';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  ChatRequestBodySchema,
  type ApiError,
} from '@aiko/shared';
import { handleChatRequest } from './service';

/** 普通 JSON 请求体大小上限（api-contract.md §3.2：聊天 ≤ 128KB）。 */
const CHAT_BODY_MAX_BYTES = 128 * 1024;

/**
 * POST /api/chat（M3.1）：
 * route 层只负责 Content-Type / 大小 / schema 校验与错误码映射，
 * 校验通过后交给 chat service（M3.2 起实现）。
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

  // M3.2 起由 service 实现真实链路；当前必然抛错，由 500 兜底。
  try {
    return await handleChatRequest({ body: parsed.data });
  } catch (error) {
    const body: ApiError = {
      code: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Chat pipeline failed',
    };
    return c.json(body, 500);
  }
});