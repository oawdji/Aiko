import type { AgentStateEvent } from '@aiko/shared';
import type { AppUIMessage } from '../types';

export function extractStateEvents(messages: AppUIMessage[]): AgentStateEvent[] {
  const events: AgentStateEvent[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'data-agent-state-event') {
        events.push(part.data.event);
      }
    }
  }
  return events;
}