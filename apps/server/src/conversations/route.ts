import { Hono } from 'hono';
import {
  ConversationCreateRequestSchema,
  ConversationListQuerySchema,
  MessagePageQuerySchema,
  type ApiError,
} from '@aiko/shared';
import { getDb } from '../db';
import {
  ConversationNotFoundError,
  CursorMessageNotFoundError,
  clearConversations,
  deleteConversation,
  getConversationDetail,
  listConversations,
} from './service';
import { createPythonMemoryClient } from '../chat/memory-client';
import {
  ChatConversationNotFoundError,
  LlmRequestFailedError,
  RegenerateNotApplicableError,
  handleRegenerateRequest,
} from '../chat/service';
import { ConversationAgentNotFoundError, createConversation } from './service';

/**
 * GET /api/conversations?agentId=
 * GET /api/conversations/:id?limit=&beforeId=
 * route 层职责：path/query 解析与校验 → 领域服务 → 错误码映射。不写 SQL。
 * 列表路由必须写在 :id 之前，避免 "conversations" 被当成会话 id。
 */
export const conversationsRoute = new Hono().post('/conversations', async (c) => {
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    rawBody = null;
  }
  const parsed = ConversationCreateRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    const body: ApiError = {
      code: 'INVALID_REQUEST',
      message: 'Validation failed: agentId is required',
      details: parsed.error.flatten().fieldErrors,
    };
    return c.json(body, 400);
  }
  try {
    const conversation = createConversation(getDb(), parsed.data.agentId, new Date().toISOString());
    return c.json({ conversation }, 201);
  } catch (error) {
    if (error instanceof ConversationAgentNotFoundError) {
      const body: ApiError = {
        code: 'AGENT_NOT_FOUND',
        message: error.message,
      };
      return c.json(body, 404);
    }
    throw error;
  }
}).get('/conversations', (c) => {
  const parsedQuery = ConversationListQuerySchema.safeParse({
    agentId: c.req.query('agentId'),
  });
  if (!parsedQuery.success) {
    const body: ApiError = {
      code: 'INVALID_REQUEST',
      message: 'Invalid query: agentId must be a non-empty string',
      details: parsedQuery.error.flatten().fieldErrors,
    };
    return c.json(body, 400);
  }
  return c.json(listConversations(getDb(), parsedQuery.data.agentId));
}).delete('/conversations', (c) => {
  const result = clearConversations(getDb());
  // 语义向量库存有对话原文切片，一并清空（向量库不可用则降级，不影响主流程）
  void createPythonMemoryClient().clearVectors();
  return c.json({ ok: true, deletedAt: result.deletedAt, count: result.count });
}).delete('/conversations/:id', (c) => {
  const id = c.req.param('id');
  try {
    const result = deleteConversation(getDb(), id);
    return c.json({ ok: true, deletedAt: result.deletedAt, count: result.count });
  } catch (error) {
    if (error instanceof ConversationNotFoundError) {
      const body: ApiError = {
        code: 'CONVERSATION_NOT_FOUND',
        message: `Conversation "${id}" not found`,
      };
      return c.json(body, 404);
    }
    throw error;
  }
}).get('/conversations/:id', (c) => {
  const conversationId = c.req.param('id');

  const parsedQuery = MessagePageQuerySchema.safeParse({
    limit: c.req.query('limit'),
    beforeId: c.req.query('beforeId'),
  });
  if (!parsedQuery.success) {
    const body: ApiError = {
      code: 'INVALID_REQUEST',
      message: 'Invalid query: limit must be an integer in [1, 100]',
      details: parsedQuery.error.flatten().fieldErrors,
    };
    return c.json(body, 400);
  }

  try {
    const response = getConversationDetail(getDb(), conversationId, parsedQuery.data);
    return c.json(response);
  } catch (error) {
    if (error instanceof CursorMessageNotFoundError) {
      const body: ApiError = {
        code: 'INVALID_REQUEST',
        message: 'beforeId is not a message of this conversation',
      };
      return c.json(body, 400);
    }
    if (error instanceof ConversationNotFoundError) {
      const body: ApiError = {
        code: 'CONVERSATION_NOT_FOUND',
        message: `Conversation "${conversationId}" not found`,
      };
      return c.json(body, 404);
    }
    throw error;
  }
})
.post('/conversations/:id/regenerate', async (c) => {
  const conversationId = c.req.param('id');
  try {
    return await handleRegenerateRequest(
      { conversationId },
      getDb(),
      new Date().toISOString(),
    );
  } catch (error) {
    if (error instanceof RegenerateNotApplicableError) {
      const body: ApiError = {
        code: 'REGENERATE_NOT_APPLICABLE',
        message: error.message,
      };
      return c.json(body, 409);
    }
    if (error instanceof ChatConversationNotFoundError) {
      const body: ApiError = {
        code: 'CONVERSATION_NOT_FOUND',
        message: error.message,
      };
      return c.json(body, 404);
    }
    if (error instanceof LlmRequestFailedError) {
      const body: ApiError = {
        code: 'LLM_REQUEST_FAILED',
        message: 'LLM request failed. Please check LLM config or retry later.',
      };
      return c.json(body, 500);
    }
    throw error;
  }
});