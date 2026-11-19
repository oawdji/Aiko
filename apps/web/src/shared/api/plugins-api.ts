import {
  PluginListResponseSchema,
  type PluginListResponse,
} from '@aiko/shared';
import { requestJson, type RequestOptions } from './client';

/**
 * Plugins 领域函数（Phase 2：清单 / 启停）。
 * 组件只能通过这些函数访问 plugins API，不得直接 fetch。
 */

export function fetchPlugins(options: RequestOptions = {}): Promise<PluginListResponse> {
  return requestJson('/plugins', PluginListResponseSchema, options);
}

export function updatePlugin(
  pluginId: string,
  enabled: boolean,
  options: RequestOptions = {},
): Promise<PluginListResponse> {
  return requestJson(`/plugins/${encodeURIComponent(pluginId)}`, PluginListResponseSchema, {
    ...options,
    method: 'PATCH',
    body: { enabled },
  });
}