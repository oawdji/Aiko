import { Hono } from 'hono';
import { DiaryListQuerySchema, type ApiError } from '@aiko/shared';
import { getDb } from '../db';
import { DiaryNotFoundError, deleteDiaryEntry, listDiaryEntries } from './service';

/**
 * GET /api/diary（日记列表，透明性：她的内心记录对用户开放）
 * DELETE /api/diary/:id（删除单篇）
 */
export const diaryRoute = new Hono()
  .get('/diary', (c) => {
    const sp = new URL(c.req.url).searchParams;
    const parsed = DiaryListQuerySchema.safeParse({
      type: sp.get('type') ?? undefined,
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
    return c.json(listDiaryEntries(getDb(), parsed.data));
  })
  .delete('/diary/:id', (c) => {
    const id = c.req.param('id');
    try {
      return c.json(deleteDiaryEntry(getDb(), id));
    } catch (error) {
      if (error instanceof DiaryNotFoundError) {
        const body: ApiError = {
          code: 'DIARY_NOT_FOUND',
          message: error.message,
        };
        return c.json(body, 404);
      }
      throw error;
    }
  });