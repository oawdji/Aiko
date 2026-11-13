import { Hono } from 'hono';
import {
  DEFAULT_AGENT_ID,
  LOCAL_USER_ID,
  MemoryListQuerySchema,
  InvalidMemoryTransitionError,
  MemoryPatchBodySchema,
  type ApiError,
} from '@aiko/shared';
import { getDb } from '../db';
import type { Context } from 'hono';
import {
  confirmMemory,
  deleteMemory,
  getMemories,
  MemoryNotFoundError,
  patchMemory,
  rejectMemory,
  restoreMemory,
} from './service';
import type { MemoryOwner } from './repository';

/**
 * /api/memories（api-contract §6.5，memory-emotion-design.md §7.1）。
 * route 只做校验与错误码映射；owner 由本地单用户常量解析，未来多 Agent 再扩展。
 */
function resolveOwner(): MemoryOwner {
  return { userId: LOCAL_USER_ID, agentId: DEFAULT_AGENT_ID };
}

function errorBody(code: ApiError['code'], message: string, details?: unknown): ApiError {
  return { code, message, ...(details !== undefined ? { details } : {}) };
}

function parseListQuery(url: string) {
  const sp = new URL(url).searchParams;
  const limit = sp.get('limit');
  const offset = sp.get('offset');
  return MemoryListQuerySchema.safeParse({
    status: sp.get('status') ?? undefined,
    type: sp.get('type') ?? undefined,
    limit: limit === null ? undefined : Number(limit),
    offset: offset === null ? undefined : Number(offset),
  });
}

function handleError(c: Context, error: unknown, id: string) {
  if (error instanceof MemoryNotFoundError) {
    return c.json(errorBody('MEM_NOT_FOUND', error.message), 404);
  }
  if (error instanceof InvalidMemoryTransitionError) {
    return c.json(errorBody('INVALID_TRANSITION', error.message), 409);
  }
  console.error(`memories route error for ${id}:`, error);
  return c.json(errorBody('INTERNAL_ERROR', 'Internal server error'), 500);
}

export const memoriesRoute = new Hono()
  .get('/memories', (c) => {
    const parsed = parseListQuery(c.req.url);
    if (!parsed.success) {
      return c.json(
        errorBody('INVALID_REQUEST', 'Validation failed', parsed.error.flatten().fieldErrors),
        400,
      );
    }
    try {
      return c.json({ memories: getMemories(getDb(), resolveOwner(), parsed.data) });
    } catch (error) {
      return handleError(c, error, '*');
    }
  })
  .patch('/memories/:id', async (c) => {
    const id = c.req.param('id');
    let rawBody: unknown;
    try {
      rawBody = JSON.parse(await c.req.text());
    } catch {
      return c.json(errorBody('INVALID_REQUEST', 'Request body must be valid JSON'), 400);
    }
    const parsed = MemoryPatchBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        errorBody('INVALID_REQUEST', 'Validation failed', parsed.error.flatten().fieldErrors),
        400,
      );
    }
    if (parsed.data.content === undefined && parsed.data.type === undefined) {
      return c.json(errorBody('INVALID_REQUEST', 'At least one of content/type is required'), 400);
    }
    try {
      return c.json(patchMemory(getDb(), resolveOwner(), id, parsed.data));
    } catch (error) {
      return handleError(c, error, id);
    }
  })
  .delete('/memories/:id', (c) => {
    const id = c.req.param('id');
    try {
      return c.json(deleteMemory(getDb(), resolveOwner(), id));
    } catch (error) {
      return handleError(c, error, id);
    }
  })
  .post('/memories/:id/confirm', (c) => {
    const id = c.req.param('id');
    try {
      return c.json(confirmMemory(getDb(), resolveOwner(), id));
    } catch (error) {
      return handleError(c, error, id);
    }
  })
  .post('/memories/:id/reject', (c) => {
    const id = c.req.param('id');
    try {
      return c.json(rejectMemory(getDb(), resolveOwner(), id));
    } catch (error) {
      return handleError(c, error, id);
    }
  })
  .post('/memories/:id/restore', (c) => {
    const id = c.req.param('id');
    try {
      return c.json(restoreMemory(getDb(), resolveOwner(), id));
    } catch (error) {
      return handleError(c, error, id);
    }
  });
