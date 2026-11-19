/**
 * 插件启停持久化（Phase 2）。
 *
 * 禁用的插件 id 列表存于 app_settings（键 plugin_disabled，JSON 数组），
 * 各挂载点运行时据此过滤。沿用"app_settings 只补缺失键、读时解析"的既有约定。
 */

import { eq } from 'drizzle-orm';
import type { DbHandle } from '../db/client';
import { appSettings } from '../db/schema';

const PLUGIN_DISABLED_KEY = 'plugin_disabled';

export function getDisabledPluginIds(handle: DbHandle): string[] {
  const row = handle.db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, PLUGIN_DISABLED_KEY))
    .get();
  if (!row) return [];
  try {
    const parsed: unknown = JSON.parse(row.valueJson);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** 启用/禁用插件，返回最新的禁用列表（upsert，事务内完成）。 */
export function setPluginEnabled(
  handle: DbHandle,
  pluginId: string,
  enabled: boolean,
  now: string,
): string[] {
  const current = getDisabledPluginIds(handle);
  const next = enabled
    ? current.filter((id) => id !== pluginId)
    : current.includes(pluginId)
      ? current
      : [...current, pluginId];
  if (next === current) return current;

  const valueJson = JSON.stringify(next);
  handle.sqlite.transaction(() => {
    const existing = handle.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, PLUGIN_DISABLED_KEY))
      .get();
    if (existing) {
      handle.db
        .update(appSettings)
        .set({ valueJson, updatedAt: now })
        .where(eq(appSettings.key, PLUGIN_DISABLED_KEY))
        .run();
    } else {
      handle.db
        .insert(appSettings)
        .values({ key: PLUGIN_DISABLED_KEY, valueJson, updatedAt: now })
        .run();
    }
  })();
  return next;
}