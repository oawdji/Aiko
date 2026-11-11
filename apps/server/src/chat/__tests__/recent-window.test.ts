import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { toPromptWindow } from '../recent-window';

function msg(id: string, role: 'user' | 'assistant' | 'system', text: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', text }],
  } as UIMessage;
}

describe('toPromptWindow', () => {
  it('extracts user/assistant text in order', () => {
    const result = toPromptWindow([
      msg('1', 'user', '你好'),
      msg('2', 'assistant', '很高兴见到你'),
      msg('3', 'system', '系统消息'),
    ]);

    expect(result).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '很高兴见到你' },
    ]);
  });

  it('keeps only the last N messages', () => {
    const messages = Array.from({ length: 40 }, (_, i) =>
      msg(`m${i}`, i % 2 === 0 ? 'user' : 'assistant', `消息${i}`),
    );

    const result = toPromptWindow(messages, 30);

    expect(result).toHaveLength(30);
    expect(result[0]?.content).toBe('消息10');
    expect(result.at(-1)?.content).toBe('消息39');
  });

  it('drops empty text messages', () => {
    const result = toPromptWindow([
      msg('1', 'user', '   '),
      msg('2', 'user', '有效消息'),
    ]);

    expect(result).toEqual([{ role: 'user', content: '有效消息' }]);
  });
});