import type { AgentStateEvent, AgentEmotionState, BootstrapResponse, EmotionTag } from '@aiko/shared';
import { createStore, useStore, type Store } from './create-store';

export type AgentStateStoreState = {
  agentId: string | null;
  state: AgentEmotionState;
  discreteTag: EmotionTag;
  stateUpdatedAt: string | null;
  latestEvent: AgentStateEvent | null;
  /** 会话期间收到的事件数（含 bootstrap 恢复的最新一条），仅供 UI 展示。 */
  receivedCount: number;
};

export type AgentStateStore = Store<AgentStateStoreState> & {
  initFromBootstrap: (data: BootstrapResponse) => void;
  applyStateEvent: (event: AgentStateEvent) => void;
  reset: () => void;
};

export const DEFAULT_AGENT_EMOTION: AgentEmotionState = { valence: 0, arousal: 0 };

/**
 * AgentStateStore（react-architecture.md §8.3）：
 * 前端不计算情绪，只信任后端事件；latestEvent 不保留全部历史。
 */
export const agentStateStore: AgentStateStore = (() => {
  const base = createStore<AgentStateStoreState>({
    agentId: null,
    state: DEFAULT_AGENT_EMOTION,
    discreteTag: 'neutral',
    stateUpdatedAt: null,
    latestEvent: null,
    receivedCount: 0,
  });

  return {
    ...base,
    initFromBootstrap: (data) =>
      base.setState({
        agentId: data.agent.id,
        state: data.agent.currentState,
        discreteTag: data.agent.currentTag,
        stateUpdatedAt: data.agent.stateUpdatedAt,
        latestEvent: data.latestStateEvent,
        receivedCount: data.latestStateEvent ? 1 : 0,
      }),
    applyStateEvent: (event) =>
      base.setState((prev) => {
        if (prev.latestEvent?.id === event.id) return prev;
        return {
          state: event.after,
          discreteTag: event.discreteTag,
          stateUpdatedAt: event.createdAt,
          latestEvent: event,
          receivedCount: prev.receivedCount + 1,
        };
      }),
    reset: () =>
      base.setState({
        agentId: null,
        state: DEFAULT_AGENT_EMOTION,
        discreteTag: 'neutral',
        stateUpdatedAt: null,
        latestEvent: null,
        receivedCount: 0,
      }),
  };
})();

export function useAgentStateStore<R>(selector: (state: AgentStateStoreState) => R): R {
  return useStore(agentStateStore, selector);
}