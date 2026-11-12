import {
  LlmConnectionTestResponseSchema,
  SettingsResponseSchema,
  type LlmConnectionTestResponse,
  type SettingsResponse,
  type UpdateSettingsRequestBody,
} from '@aiko/shared';
import { requestJson, type RequestOptions } from './client';

/**
 * Settings 领域函数（api-contract.md §11/§12/§12.6）：
 * 组件只能通过这些函数访问 settings API，不得直接 fetch。
 */

export function fetchSettings(options: RequestOptions = {}): Promise<SettingsResponse> {
  return requestJson('/settings', SettingsResponseSchema, options);
}

export function updateSettings(
  body: UpdateSettingsRequestBody,
  options: RequestOptions = {},
): Promise<SettingsResponse> {
  return requestJson('/settings', SettingsResponseSchema, {
    ...options,
    method: 'PATCH',
    body,
  });
}

export function testLlmConnection(
  options: RequestOptions = {},
): Promise<LlmConnectionTestResponse> {
  return requestJson('/settings/llm/test', LlmConnectionTestResponseSchema, {
    ...options,
    method: 'POST',
    timeoutMs: 30_000,
  });
}