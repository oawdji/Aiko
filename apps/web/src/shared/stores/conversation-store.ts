import type { BootstrapResponse } from '@aiko/shared';
import { createStore, useStore, type Store } from './create-store';

export type ConversationStatus = 'idle' | 'loading' | 'ready' | 'error';

export type ConversationStoreState = {
  conversationId: string | null;
  agentId: string | null;
  status: ConversationStatus;
  errorCode: string | null;
};

export type ConversationStore = Store<ConversationStoreState> & {
  setLoading: () => void;
  setBootstrapData: (data: BootstrapResponse) => void;
  setError: (errorCode: string) => void;
  reset: () => void;
};

/**
 * ConversationStore（react-architecture.md §8.2）：
 * 只保存会话元信息与 bootstrap 状态机；消息、Agent 状态、设置一律不进本 store。
 */
export const conversationStore: ConversationStore = (() => {
  const base = createStore<ConversationStoreState>({
    conversationId: null,
    agentId: null,
    status: 'idle',
    errorCode: null,
  });

  return {
    ...base,
    setLoading: () => base.setState({ status: 'loading', errorCode: null }),
    setBootstrapData: (data) =>
      base.setState({
        conversationId: data.conversation.id,
        agentId: data.agent.id,
        status: 'ready',
        errorCode: null,
      }),
    setError: (errorCode) => base.setState({ status: 'error', errorCode }),
    reset: () =>
      base.setState({
        conversationId: null,
        agentId: null,
        status: 'idle',
        errorCode: null,
      }),
  };
})();

export function useConversationStore<R>(selector: (state: ConversationStoreState) => R): R {
  return useStore(conversationStore, selector);
}