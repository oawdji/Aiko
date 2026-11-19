import { Hono } from 'hono';
import { SummaryListQuerySchema, type ApiError } from '@aiko/shared';
import { getDb } from '../db';
import { SummaryNotFoundError, deleteSummary, listSummaries } from './service';

/**
 * GET /api/summaries（会话摘要列表，透明性：她记得的阶段性回顾对用户可见）
 * DELETE /api/summaries/:id（软删除，删除后不再注入 prompt）
 */
export const summariesRoute = new Hono()
  .get('/summaries', (c) => {
    const sp = new URL(c.req.url).searchParams;
    const parsed = SummaryListQuerySchema.safeParse({
      conversationId: sp.get('conversationId') ?? undefined,
      limit: sp.get('limit') === null ? undefined : Number(sp.get('limit')),
      offset: sp.get('offset') === null ? undefined : Number(sp.get('offset')),
    });
    if (!parsed.success) {
      const body: ApiError = {
        code: 'INVALID_REQUEST',
        message: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      };
      return c.json(body, 400);
    }
    return c.json(listSummaries(getDb(), parsed.data));
  })
  .delete('/summaries/:id', (c) => {
    const id = c.req.param('id');
    try {
      return c.json(deleteSummary(getDb(), id, new Date().toISOString()));
    } catch (error) {
      if (error instanceof SummaryNotFoundError) {
        const body: ApiError = {
          code: 'SUMMARY_NOT_FOUND',
          message: error.message,
        };
        return c.json(body, 404);
      }
      throw error;
    }
  });