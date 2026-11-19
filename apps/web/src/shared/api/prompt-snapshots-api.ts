import {
  PromptSnapshotClearResponseSchema,
  PromptSnapshotListResponseSchema,
  type PromptSnapshotClearResponse,
  type PromptSnapshotListQuery,
  type PromptSnapshotListResponse,
} from '@aiko/shared';
import { requestJson, type RequestOptions } from './client';

/**
 * Prompt 快照领域函数（F36：debug 模式审计）。
 */

function qs(query: Partial<PromptSnapshotListQuery>): string {
  const sp = new URLSearchParams();
  if (query.conversationId) sp.set('conversationId', query.conversationId);
  if (query.limit !== undefined) sp.set('limit', String(query.limit));
  if (query.offset !== undefined) sp.set('offset', String(query.offset));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function fetchPromptSnapshots(
  query: Partial<PromptSnapshotListQuery> = {},
  options: RequestOptions = {},
): Promise<PromptSnapshotListResponse> {
  return requestJson(`/prompt-snapshots${qs(query)}`, PromptSnapshotListResponseSchema, options);
}

/** 清空全部快照（不可恢复，调用方需自行二次确认）。 */
export function clearPromptSnapshots(
  options: RequestOptions = {},
): Promise<PromptSnapshotClearResponse> {
  return requestJson('/prompt-snapshots', PromptSnapshotClearResponseSchema, {
    ...options,
    method: 'DELETE',
  });
}