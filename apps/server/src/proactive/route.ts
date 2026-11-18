import { Hono } from 'hono';
import {
  DEFAULT_AGENT_ID,
  ProactiveEvaluateBodySchema,
  type ApiError,
} from '@aiko/shared';
import { getDb } from '../db';
import {
  ProactiveConversationNotFoundError,
  evaluateProactive,
  listProactiveHistory,
} from './service';

function errorBody(code: ApiError['code'], message: string): ApiError {
  return { code, message };
}

/**
 * 主动消息接口（Phase 4，api-contract §22.3）：
 * - evaluate 由前端空闲计时器触发，页面关闭/刷新后不可能调用；
 * - 无状态单次决策：被抑制不落库、不补发；
 * - 开关默认关闭（app_settings.proactive_enabled）。
 */
export const proactiveRoute = new Hono()
  .post('/proactive/evaluate', async (c) => {
    let raw: unknown;
    try {
      raw = JSON.parse(await c.req.text());
    } catch {
      return c.json(errorBody('INVALID_REQUEST', 'Request body must be valid JSON'), 400);
    }
    const parsed = ProactiveEvaluateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(errorBody('INVALID_REQUEST', 'Validation failed'), 400);
    }
    try {
      const result = await evaluateProactive(getDb(), {
        agentId: parsed.data.agentId ?? DEFAULT_AGENT_ID,
        conversationId: parsed.data.conversationId,
        localMinutesOfDay: parsed.data.localMinutesOfDay,
        now: new Date().toISOString(),
      });
      return c.json(result);
    } catch (error) {
      if (error instanceof ProactiveConversationNotFoundError) {
        return c.json(errorBody('PROACTIVE_CONVERSATION_NOT_FOUND', error.message), 404);
      }
      console.error('[proactive] route error:', error);
      return c.json(errorBody('INTERNAL_ERROR', 'Internal server error'), 500);
    }
  })
  .get('/proactive/history', (c) => {
    const agentId = c.req.query('agentId') ?? DEFAULT_AGENT_ID;
    const limitRaw = Number(c.req.query('limit') ?? '50');
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;
    return c.json({ messages: listProactiveHistory(getDb(), agentId, limit) });
  });
