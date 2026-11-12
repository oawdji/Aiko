import { DEFAULT_AGENT_SLUG, type BootstrapResponse } from '@aiko/shared';
import { ApiClientError } from '../shared/api/errors';
import { fetchBootstrap } from '../shared/api/chat-recovery';

export type BootstrapOutcome =
  | { status: 'ready'; data: BootstrapResponse }
  | { status: 'error'; errorCode: string };

export type BootstrapFetcher = typeof fetchBootstrap;

/**
 * M2.5 启动流程纯函数（react-architecture.md §10.1）：
 * fetch 与 store 解耦，便于测试；hook 层负责把 outcome 写进 store。
 */
export async function runBootstrap(
  fetchFn: BootstrapFetcher = fetchBootstrap,
  agentRef: string = DEFAULT_AGENT_SLUG,
): Promise<BootstrapOutcome> {
  try {
    const data = await fetchFn(agentRef);
    return { status: 'ready', data };
  } catch (error) {
    const errorCode =
      error instanceof ApiClientError ? error.code : 'INTERNAL_ERROR';
    return { status: 'error', errorCode };
  }
}