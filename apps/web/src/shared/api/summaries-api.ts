import {
  SummaryDeleteResponseSchema,
  SummaryListResponseSchema,
  type SummaryDeleteResponse,
  type SummaryListQuery,
  type SummaryListResponse,
} from '@aiko/shared';
import { requestJson, type RequestOptions } from './client';

/**
 * Summaries 领域函数（透明性：会话摘要对用户可见可删除）。
 */

function qs(query: Partial<SummaryListQuery>): string {
  const sp = new URLSearchParams();
  if (query.conversationId) sp.set('conversationId', query.conversationId);
  if (query.limit !== undefined) sp.set('limit', String(query.limit));
  if (query.offset !== undefined) sp.set('offset', String(query.offset));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function fetchSummaries(
  query: Partial<SummaryListQuery> = {},
  options: RequestOptions = {},
): Promise<SummaryListResponse> {
  return requestJson(`/summaries${qs(query)}`, SummaryListResponseSchema, options);
}

/** 软删除：删除后该摘要不再注入对话上下文。 */
export function deleteSummary(
  id: string,
  options: RequestOptions = {},
): Promise<SummaryDeleteResponse> {
  return requestJson(`/summaries/${encodeURIComponent(id)}`, SummaryDeleteResponseSchema, {
    ...options,
    method: 'DELETE',
  });
}