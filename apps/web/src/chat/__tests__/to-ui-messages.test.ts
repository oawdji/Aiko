import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_ID } from '@aiko/shared';
import type { ChatMessageDTO } from '@aiko/shared';
import type { AppUIMessage } from '../types';
import { toUiMessages } from '../utils/to-ui-messages';

function makeMessage(
  over: Partial<ChatMessageDTO>,
): ChatMessageDTO {
  return {
    id: 'msg_1',
    conversationId: 'conv_1',
    agentId: DEFAULT_AGENT_ID,
    role: 'user',
    content: '你好',
    status: 'complete',
    errorCode: null,
    createdAt: '2026-11-11T08:00:00.000Z',
    ...over,
  };
}

describe('toUiMessages', () => {
  it('converts restored DTOs into text-part UIMessages', () => {
    const result: AppUIMessage[] = toUiMessages([
      makeMessage({ id: 'msg_1', role: 'user', content: '你好' }),
      makeMessage({ id: 'msg_2', role: 'assistant', content: '很高兴见到你' }),
    ]);

    expect(result).toEqual([
      {
        id: 'msg_1',
        role: 'user',
        parts: [{ type: 'text', text: '你好' }],
      },
      {
        id: 'msg_2',
        role: 'assistant',
        parts: [{ type: 'text', text: '很高兴见到你' }],
      },
    ]);
  });

  it('keeps message order stable', () => {
    const result: AppUIMessage[] = toUiMessages([
      makeMessage({ id: 'a' }),
      makeMessage({ id: 'b' }),
    ]);
    expect(result.map((m) => m.id)).toEqual(['a', 'b']);
  });
});