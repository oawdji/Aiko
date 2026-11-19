import {
  DiaryDeleteResponseSchema,
  DiaryListResponseSchema,
  type DiaryDeleteResponse,
  type DiaryListQuery,
  type DiaryListResponse,
} from '@aiko/shared';
import { requestJson, type RequestOptions } from './client';

/**
 * Diary 领域函数（虚拟人内心生活：日记面板）。
 */

function qs(query: Partial<DiaryListQuery>): string {
  const sp = new URLSearchParams();
  if (query.type) sp.set('type', query.type);
  if (query.limit !== undefined) sp.set('limit', String(query.limit));
  if (query.offset !== undefined) sp.set('offset', String(query.offset));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function fetchDiary(
  query: Partial<DiaryListQuery> = {},
  options: RequestOptions = {},
): Promise<DiaryListResponse> {
  return requestJson(`/diary${qs(query)}`, DiaryListResponseSchema, options);
}

/** 删除单篇日记（不可恢复，调用方需自行二次确认）。 */
export function deleteDiary(
  id: string,
  options: RequestOptions = {},
): Promise<DiaryDeleteResponse> {
  return requestJson(`/diary/${encodeURIComponent(id)}`, DiaryDeleteResponseSchema, {
    ...options,
    method: 'DELETE',
  });
}