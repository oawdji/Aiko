import { Hono } from 'hono';
import { PromptSnapshotListQuerySchema, type ApiError } from '@aiko/shared';
import { getDb } from '../db';
import { clearAllPromptSnapshots, listPromptSnapshots } from './service';

/**
 * GET /api/prompt-snapshots（debug_mode 快照查看器：审计 prompt 组装与插件注入）
 * DELETE /api/prompt-snapshots（清空全部快照）
 */
export const promptSnapshotsRoute = new Hono()
  .get('/prompt-snapshots', (c) => {
    const sp = new URL(c.req.url).searchParams;
    const parsed = PromptSnapshotListQuerySchema.safeParse({
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
    return c.json(listPromptSnapshots(getDb(), parsed.data));
  })
  .delete('/prompt-snapshots', (c) => {
    return c.json(clearAllPromptSnapshots(getDb()));
  });