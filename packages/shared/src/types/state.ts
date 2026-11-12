import type { AgentStateEvent } from '../schemas/api';

// 状态事件类型本体由 schemas/api.ts 推导（M2.1）。
export type {
  AgentStateEventSource,
  AgentStateEvent,
} from '../schemas/api';

export type AgentStateEventData = {
  event: AgentStateEvent;
};