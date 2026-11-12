import { useCallback, useEffect, useState } from 'react';
import type { BootstrapResponse } from '@aiko/shared';
import { fetchBootstrap } from '../shared/api/chat-recovery';
import { agentStateStore } from '../shared/stores/agent-state-store';
import { conversationStore } from '../shared/stores/conversation-store';
import { runBootstrap } from './bootstrap-flow';

export type BootstrapFlow =
  | { status: 'loading' }
  | { status: 'error'; errorCode: string }
  | { status: 'ready'; data: BootstrapResponse };

/**
 * App 级启动 hook（react-architecture.md §10）：
 * - mount 后 loading → GET /api/bootstrap；
 * - 成功写 ConversationStore + AgentStateStore；bootstrap 数据由本 hook 持有，
 *   messages 是 useChat 初始状态的唯一来源，不复制进任何 store；
 * - 失败进入全页错误（§10.3），retry 重跑整个流程。
 */
export function useBootstrap(): BootstrapFlow & { retry: () => void } {
  const [flow, setFlow] = useState<BootstrapFlow>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    conversationStore.setLoading();
    agentStateStore.reset();

    void runBootstrap((agentRef) =>
      fetchBootstrap(agentRef, { signal: controller.signal }),
    ).then((outcome) => {
      if (controller.signal.aborted) return;
      if (outcome.status === 'ready') {
        conversationStore.setBootstrapData(outcome.data);
        agentStateStore.initFromBootstrap(outcome.data);
        setFlow({ status: 'ready', data: outcome.data });
      } else {
        conversationStore.setError(outcome.errorCode);
        setFlow({ status: 'error', errorCode: outcome.errorCode });
      }
    });

    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => {
    setFlow({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  return { ...flow, retry };
}