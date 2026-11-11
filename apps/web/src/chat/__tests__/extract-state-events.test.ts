import { describe, expect, it } from 'vitest';
import type { AgentStateEvent, AgentStateEventData } from '@aiko/shared';
import { extractStateEvents } from '../utils/extract-state-events';

const event = {
  id: 'state_1',
} as AgentStateEvent;

const part = {
  type: 'data-agent-state-event',
  data: { event } satisfies AgentStateEventData,
};

describe('extractStateEvents', () => {
  it('collects state events from message data parts', () => {
    const messages = [
      {
        id: 'm1',
        role: 'user',
        parts: [{ type: 'text', text: '你好' }],
      },
      {
        id: 'm2',
        role: 'assistant',
        parts: [part, { type: 'text', text: '回复' }],
      },
    ] as never;

    expect(extractStateEvents(messages)).toEqual([event]);
  });

  it('ignores unknown data parts', () => {
    const messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [{ type: 'data-unknown', data: { foo: 1 } }],
      },
    ] as never;

    expect(extractStateEvents(messages)).toEqual([]);
  });
});