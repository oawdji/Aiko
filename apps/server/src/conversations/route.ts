import { Hono } from 'hono';
import { ConversationListQuerySchema, MessagePageQuerySchema, type ApiError } from '@aiko/shared';
import { getDb } from '../db';
import {
  ConversationNotFoundError,
  CursorMessageNotFoundError,
  getConversationDetail,
  listConversations,
} from './service';

/**
 * GET /api/conversations?agentId=
 * GET /api/conversations/:id?limit=&beforeId=
 * route 层职责：path/query 解析与校验 → 领域服务 → 错误码映射。不写 SQL。
 * 列表路由必须写在 :id 之前，避免 "conversations" 被当成会话 id。
 */
export const conversationsRoute = new Hono().get('/conversations', (c) => {
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
});