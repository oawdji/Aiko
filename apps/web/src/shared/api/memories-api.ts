import {
  MemoryListResponseSchema,
  MemoryFactDTOSchema,
  type MemoryFactDTO,
  type MemoryListQuery,
} from '@aiko/shared';
import { requestJson, type RequestOptions } from './client';

/**
 * Memories 领域函数（api-contract §6.5）：
 * 乐观更新发生在组件层，这里只负责契约校验的真实请求。
 */

function qs(query: Partial<MemoryListQuery>): string {
  const sp = new URLSearchParams();
  if (query.status) sp.set('status', query.status);
  if (query.type) sp.set('type', query.type);
  if (query.limit !== undefined) sp.set('limit', String(query.limit));
  if (query.offset !== undefined) sp.set('offset', String(query.offset));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function fetchMemories(
  query: Partial<MemoryListQuery> = {},
  options: RequestOptions = {},
): Promise<MemoryFactDTO[]> {
  return requestJson(`/memories${qs(query)}`, MemoryListResponseSchema, options).then(
    (r) => r.memories,
  );
}

export function patchMemory(
  id: string,
  body: { content?: string; type?: MemoryFactDTO['type'] },
  options: RequestOptions = {},
): Promise<MemoryFactDTO> {
  return requestJson(`/memories/${id}`, MemoryFactDTOSchema, {
    ...options,
    method: 'PATCH',
    body,
  });
}

export function deleteMemory(
  id: string,
  options: RequestOptions = {},
): Promise<MemoryFactDTO> {
  return requestJson(`/memories/${id}`, MemoryFactDTOSchema, {
    ...options,
    method: 'DELETE',
  });
}

export function confirmMemory(
  id: string,
  options: RequestOptions = {},
): Promise<MemoryFactDTO> {
  return requestJson(`/memories/${id}/confirm`, MemoryFactDTOSchema, {
    ...options,
    method: 'POST',
  });
}

export function rejectMemory(
  id: string,
  options: RequestOptions = {},
): Promise<MemoryFactDTO> {
  return requestJson(`/memories/${id}/reject`, MemoryFactDTOSchema, {
    ...options,
    method: 'POST',
  });
}
