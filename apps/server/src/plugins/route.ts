import { Hono } from 'hono';
import type { DbHandle } from '../db/client';
import { PluginUpdateRequestSchema, type ApiError, type PluginInfo } from '@aiko/shared';
import { getDb } from '../db';
import { getDisabledPluginIds, setPluginEnabled } from './persistence';
import { contextContributorRegistry } from './context-contributors';
import { emotionExtractorRegistry } from './emotion-extractors';
import { memoryRetrieverRegistry } from './retriever';
import { proactiveStrategyRegistry } from '../proactive/strategy';

/**
 * GET /api/plugins（清单 + 启用状态）
 * PATCH /api/plugins/:id（启停；app_settings 持久化，即时生效）
 */

function listPlugins(handle: DbHandle): PluginInfo[] {
  const disabled = new Set(getDisabledPluginIds(handle));
  const out: PluginInfo[] = [];
  for (const p of contextContributorRegistry.all()) {
    out.push({
      id: p.id,
      mountPoint: 'context-contributor',
      description: p.description ?? null,
      order: p.order,
      enabled: !disabled.has(p.id),
    });
  }
  for (const p of proactiveStrategyRegistry.all()) {
    out.push({
      id: p.id,
      mountPoint: 'proactive-strategy',
      description: p.description ?? null,
      priority: p.priority,
      enabled: !disabled.has(p.id),
    });
  }
  for (const p of emotionExtractorRegistry.all()) {
    out.push({
      id: p.id,
      mountPoint: 'emotion-extractor',
      description: p.description ?? null,
      enabled: !disabled.has(p.id),
    });
  }
  for (const p of memoryRetrieverRegistry.all()) {
    out.push({
      id: p.id,
      mountPoint: 'memory-retriever',
      description: p.description ?? null,
      enabled: !disabled.has(p.id),
    });
  }
  return out;
}

function findRegistered(id: string): boolean {
  return (
    contextContributorRegistry.has(id) ||
    proactiveStrategyRegistry.has(id) ||
    emotionExtractorRegistry.has(id) ||
    memoryRetrieverRegistry.has(id)
  );
}

export const pluginsRoute = new Hono()
  .get('/plugins', (c) => {
    return c.json({ plugins: listPlugins(getDb()) });
  })
  .patch('/plugins/:id', async (c) => {
    const id = c.req.param('id');
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      rawBody = null;
    }
    const parsed = PluginUpdateRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      const body: ApiError = {
        code: 'INVALID_REQUEST',
        message: 'Validation failed: enabled is required',
        details: parsed.error.flatten().fieldErrors,
      };
      return c.json(body, 400);
    }
    const handle = getDb();
    if (!findRegistered(id)) {
      const body: ApiError = {
        code: 'PLUGIN_NOT_FOUND',
        message: `Plugin "${id}" not found`,
      };
      return c.json(body, 404);
    }
    setPluginEnabled(handle, id, parsed.data.enabled, new Date().toISOString());
    return c.json({ plugins: listPlugins(handle) });
  });