import type { UIMessage } from 'ai';

export type PromptMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export const DEFAULT_MAX_CONTEXT_MESSAGES = 30;

function textOf(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

/**
 * Phase 0 近期窗口原型：
 * 从前端 transport 携带的历史消息中提取 user/assistant 文本，
 * 只保留最近 maxContextMessages 条，作为进入 Prompt 的上下文。
 * MVP 阶段将由数据库查询替代前端携带，本函数保持纯函数可复用。
 */
export function toPromptWindow(
  messages: UIMessage[],
  maxContextMessages: number = DEFAULT_MAX_CONTEXT_MESSAGES,
): PromptMessage[] {
  return messages
    .filter(
      (m): m is UIMessage & { role: 'user' | 'assistant' } =>
        m.role === 'user' || m.role === 'assistant',
    )
    .map((m) => ({ role: m.role, content: textOf(m) }))
    .filter((m) => m.content.trim().length > 0)
    .slice(-maxContextMessages);
}