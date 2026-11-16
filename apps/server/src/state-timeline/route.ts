import { Hono } from 'hono';
import { StateEventPageQuerySchema, type ApiError } from '@aiko/shared';
import { getDb } from '../db';
import { getStateEventPage, AgentNotFoundError } from './service';

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
);
