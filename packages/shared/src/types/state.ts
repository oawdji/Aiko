import type { AgentEmotionState, EmotionTag } from './emotion';

export type AgentStateEventSource =
  | 'user_message'
  | 'assistant_message'
  | 'time_decay'
  | 'manual';

export type AgentStateEvent = {
  id: string;
  agentId: string;
  conversationId: string;
  triggerMessageId: string | null;
  source: AgentStateEventSource;
  ruleVersion: string;
  before: AgentEmotionState;
  delta: AgentEmotionState;
  after: AgentEmotionState;
  discreteTag: EmotionTag;
  reason: string;
  evidenceText: string;
  confidence: number;
  createdAt: string;
};

export type AgentStateEventData = {
  event: AgentStateEvent;
};