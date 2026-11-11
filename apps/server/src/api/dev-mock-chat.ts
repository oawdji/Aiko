import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai';
import { Hono } from 'hono';

type MockChatRequestBody = {
  messages?: UIMessage[];
};

function lastUserText(body: MockChatRequestBody | null): string {
  const lastUser = body?.messages?.filter((m) => m.role === 'user').at(-1);
  if (!lastUser) return '';
  return lastUser.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

/**
 * Phase 0 开发专用 mock 端点：
 * 不调用 LLM，返回固定文案的 UIMessage Stream，
 * 用于在没有 API Key 时验证前端 useChat 的流式渲染与恢复注入。
 */
export const devMockChatRoute = new Hono().post('/dev/mock-chat', async (c) => {
  const body = (await c.req.json().catch(() => null)) as MockChatRequestBody | null;
  const echoed = lastUserText(body);

  const reply = echoed
    ? `（模拟回复，无需 LLM Key）你说的是：“${echoed}”。这条消息来自 /api/dev/mock-chat 的流式验证。`
    : '（模拟回复）这是一条无需 LLM Key 的流式验证消息。';

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      for (const chunk of reply.match(/[\s\S]{1,6}/gu) ?? []) {
        writer.write({ type: 'text-delta', id: 'mock-reply', delta: chunk });
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
});