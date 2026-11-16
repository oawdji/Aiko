import {
  BootstrapResponseSchema,
  ConversationDetailResponseSchema,
  ConversationListResponseSchema,
  HealthResponseSchema,
  type BootstrapResponse,
  type ConversationDetailResponse,
  type ConversationListResponse,
} from '@aiko/shared';
import { requestJson, type RequestOptions } from './client';

/**
 * M2.4 领域函数：组件只能调用这些函数访问 API，
 * 不得直接 fetch / requestJson（react-architecture.md §10 边界）。
 */

export function fetchHealth(options: RequestOptions = {}) {
  return requestJson('/health', HealthResponseSchema, options);
}

export function fetchBootstrap(
  agentRef?: string,
  options: RequestOptions = {},
): Promise<BootstrapResponse> {
  const query = agentRef ? `?agent=${encodeURIComponent(agentRef)}` : '';
  return requestJson(`/bootstrap${query}`, BootstrapResponseSchema, options);
}

export type ConversationPageParams = {
  limit?: number;
  beforeId?: string;
};

export function fetchConversationList(
  agentId?: string,
  options: RequestOptions = {},
): Promise<ConversationListResponse> {
  const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
  return requestJson(`/conversations${query}`, ConversationListResponseSchema, options);
}

export function fetchConversation(
  conversationId: string,
  params: ConversationPageParams = {},
  options: RequestOptions = {},
): Promise<ConversationDetailResponse> {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.beforeId !== undefined) search.set('beforeId', params.beforeId);
  const query = search.size > 0 ? `?${search.toString()}` : '';
  return requestJson(
    `/conversations/${encodeURIComponent(conversationId)}${query}`,
    ConversationDetailResponseSchema,
    options,
  );
}