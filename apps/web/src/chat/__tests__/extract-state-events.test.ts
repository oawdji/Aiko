import { describe, expect, it } from 'vitest';
import type { AgentStateEvent, AgentStateEventData } from '@aiko/shared';
import type { AppUIMessage } from '../types';
import { extractStateEvents } from '../utils/extract-state-events';

const event = {
  id: 'state_1',
} as AgentStateEvent;

const statePart: AppUIMessage['parts'][number] = {
  type: 'data-agent-state-event',
  data: { event } satisfies AgentStateEventData,
};

describe('extractStateEvents', () => {
  it('collects state events from message data parts', () => {
    const messages: AppUIMessage[] = [
      {
        id: 'm1',
        role: 'user',
        parts: [{ type: 'text', text: '你好' }],
      },
      {
        id: 'm2',
        role: 'assistant',
        parts: [statePart, { type: 'text', text: '回复' }],
      },
    ];

    expect(extractStateEvents(messages)).toEqual([event]);
  });

  it('ignores unknown data parts', () => {
    // 对抗性输入：模拟服务端发来契约外 data part 的运行时场景
    const messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [{ type: 'data-unknown', data: { foo: 1 } }],
      },
    ] as unknown as AppUIMessage[];

    expect(extractStateEvents(messages)).toEqual([]);
  });
});