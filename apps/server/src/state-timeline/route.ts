import { Hono } from 'hono';
import {
  AgentStateResetRequestSchema,
  StateEventPageQuerySchema,
  type ApiError,
} from '@aiko/shared';
import { getDb } from '../db';
import {
  AgentNotFoundError,
  ResetConversationNotFoundError,
  getStateEventPage,
  resetAgentState,
} from './service';

/**
 * GET /api/agents/:agentId/state/events（api-contract §10，状态时间线 F11）。
 * route 只做 query 解析与错误码映射。
 */
export const stateTimelineRoute = new Hono().get(
  '/agents/:agentId/state/events',
  (c) => {
    const agentId = c.req.param('agentId');
    const parsed = StateEventPageQuerySchema.safeParse({
      limit: c.req.query('limit'),
      beforeId: c.req.query('beforeId'),
    });
    if (!parsed.success) {
      const body: ApiError = {
        code: 'INVALID_REQUEST',
        message: 'Invalid query: limit must be an integer in [1, 200]',
        details: parsed.error.flatten().fieldErrors,
      };
      return c.json(body, 400);
    }

    try {
      return c.json(
        getStateEventPage(getDb(), agentId, parsed.data.limit, parsed.data.beforeId),
      );
    } catch (error) {
      if (error instanceof AgentNotFoundError) {
        const body: ApiError = {
          code: 'AGENT_NOT_FOUND',
          message: `Agent "${agentId}" not found`,
        };
        return c.json(body, 404);
      }
      throw error;
    }
  },
)
.post('/agents/:agentId/state/reset', async (c) => {
  const agentId = c.req.param('agentId');
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    rawBody = null;
  }
  const parsed = AgentStateResetRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    const body: ApiError = {
      code: 'INVALID_REQUEST',
      message: 'Validation failed: conversationId is required',
      details: parsed.error.flatten().fieldErrors,
    };
    return c.json(body, 400);
  }
  try {
    return c.json(
      resetAgentState(getDb(), agentId, parsed.data.conversationId, new Date().toISOString()),
    );
  } catch (error) {
    if (error instanceof AgentNotFoundError) {
      const body: ApiError = {
        code: 'AGENT_NOT_FOUND',
        message: `Agent "${agentId}" not found`,
      };
      return c.json(body, 404);
    }
    if (error instanceof ResetConversationNotFoundError) {
      const body: ApiError = {
        code: 'CONVERSATION_NOT_FOUND',
        message: error.message,
      };
      return c.json(body, 404);
    }
    throw error;
  }
});