import {
  StateEventPageQuerySchema,
  StateEventPageResponseSchema,
  type AgentStateEvent,
  type StateEventPageResponse,
} from '@aiko/shared';
import { requestJson, type RequestOptions } from './client';

/** 状态时间线（api-contract §10）：beforeId 游标分页。 */

export function fetchStateEvents(
  agentId: string,
  query: { limit?: number; beforeId?: string } = {},
  options: RequestOptions = {},
): Promise<StateEventPageResponse> {
  const parsed = StateEventPageQuerySchema.safeParse(query);
  const safe = parsed.success ? parsed.data : {};
  const sp = new URLSearchParams();
  if (safe.limit !== undefined) sp.set('limit', String(safe.limit));
  if (safe.beforeId !== undefined) sp.set('beforeId', safe.beforeId);
  const s = sp.toString();
  return requestJson(
    `/agents/${encodeURIComponent(agentId)}/state/events${s ? `?${s}` : ''}`,
    StateEventPageResponseSchema,
    options,
  );
}

export type StateTimelineItem = AgentStateEvent;
