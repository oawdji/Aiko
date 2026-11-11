import type { UIMessage } from 'ai';
import type { AgentStateEventData, AgentStateEvent } from '@aiko/shared';

type StateDataPart = {
  type: 'data-agent-state-event';
  data: AgentStateEventData;
};

export function extractStateEvents(messages: UIMessage[]): AgentStateEvent[] {
  const events: AgentStateEvent[] = [];
  for (const message of messages) {
    for (const part of message.parts as Array<{ type: string; data?: unknown }>) {
      if (part.type === 'data-agent-state-event') {
        const data = (part as StateDataPart).data;
        if (data && typeof data === 'object' && 'event' in data) {
          events.push(data.event);
        }
      }
    }
  }
  return events;
}