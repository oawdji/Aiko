import { Hono } from 'hono';
import { UpdateSettingsRequestBodySchema, type ApiError } from '@aiko/shared';
import { getDb } from '../db';
import {
  getSettingsResponse,
  SettingsValidationError,
  testLlmConnection,
  updateSettings,
} from './service';

/**
 * /api/settings（§11/§12/§12.6）：
 * route 只做请求校验与错误码映射，读写逻辑全部在 settings service。
 */
export const settingsRoute = new Hono()
  .get('/settings', (c) => c.json(getSettingsResponse(getDb())))
  .patch('/settings', async (c) => {
    const text = await c.req.text();
    let rawBody: unknown = {};
    if (text.trim()) {
      try {
        rawBody = JSON.parse(text);
      } catch {
        const body: ApiError = {
          code: 'INVALID_REQUEST',
          message: 'Request body must be valid JSON',
        };
        return c.json(body, 400);
      }
    }

    const parsed = UpdateSettingsRequestBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      const body: ApiError = {
        code: 'INVALID_REQUEST',
        message: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      };
      return c.json(body, 400);
    }

    try {
      return c.json(updateSettings(getDb(), parsed.data, new Date().toISOString()));
    } catch (error) {
      if (error instanceof SettingsValidationError) {
        const body: ApiError = {
          code: 'INVALID_REQUEST',
          message: error.message,
        };
        return c.json(body, 400);
      }
      throw error;
    }
  })
  .post('/settings/llm/test', async (c) => c.json(await testLlmConnection(getDb())));