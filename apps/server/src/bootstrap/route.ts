import { Hono } from 'hono';
import { DEFAULT_AGENT_SLUG, type ApiError } from '@aiko/shared';
import { getDb } from '../db';
import { AgentNotFoundError, bootstrapAgent } from './service';

/**
 * GET /api/bootstrap?agent=<slug|id>
 * route 层职责：解析 query → 调领域服务 → 映射错误码。不写 SQL。
 */
export const bootstrapRoute = new Hono().get('/bootstrap', (c) => {
  const agentRef = c.req.query('agent')?.trim() || DEFAULT_AGENT_SLUG;

  try {
    const response = bootstrapAgent(getDb(), agentRef, new Date().toISOString());
    return c.json(response);
  } catch (error) {
    if (error instanceof AgentNotFoundError) {
      const body: ApiError = {
        code: 'AGENT_NOT_FOUND',
        message: `Agent "${agentRef}" not found`,
      };
      return c.json(body, 404);
    }
    throw error;
  }
});