import {
  ProactiveEvaluateResponseSchema,
  ProactiveHistoryResponseSchema,
  type ProactiveEvaluateResponse,
  type ProactiveHistoryResponse,
} from '@aiko/shared';
import { requestJson, type RequestOptions } from '../../shared/api/client';

/** evaluate：空闲计时器触发；被抑制/关闭时不落库不补发（无状态单次决策）。 */
export function evaluateProactive(
  body: { conversationId: string; localMinutesOfDay: number; agentId?: string },
  options: RequestOptions = {},
): Promise<ProactiveEvaluateResponse> {
  return requestJson('/proactive/evaluate', ProactiveEvaluateResponseSchema, {
    ...options,
    method: 'POST',
    body,
  });
}

export function fetchProactiveHistory(
  options: RequestOptions = {},
): Promise<ProactiveHistoryResponse> {
  return requestJson('/proactive/history', ProactiveHistoryResponseSchema, options);
}
