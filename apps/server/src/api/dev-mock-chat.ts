import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai';
import { Hono } from 'hono';
import type { AgentStateEventData, AgentStateEvent } from '@aiko/shared';
import { DEFAULT_AGENT_ID } from '@aiko/shared';

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

function mockStateEvent(triggerText: string): AgentStateEvent {
  const evidence = triggerText.slice(0, 20) || '（空）';
  return {
    id: `state_mock_${Date.now().toString(36)}`,
    agentId: DEFAULT_AGENT_ID,
    conversationId: 'conv_demo',
    triggerMessageId: null,
    source: 'user_message',
    ruleVersion: 'emotion-rules-v1',
    before: { valence: 0, arousal: 0 },
    delta: { valence: -0.1, arousal: -0.04 },
    after: { valence: -0.1, arousal: -0.04 },
    discreteTag: 'low',
    reason: `（mock）你提到“${evidence}”，愉悦度略有下降。`,
    evidenceText: evidence,
    confidence: 0.7,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Phase 0 开发专用 mock 端点（T0.3 协议验证）：
 * 1. 先发送 data-agent-state-event，再发送 text-delta，验证接收顺序；
 * 2. 用户消息包含“409”时返回幂等冲突，验证前端错误归一化；
 * 3. 文本按块延迟输出，便于验证 AbortController 停止生成。
 * 不调用 LLM，无需 API Key。
 */
export const devMockChatRoute = new Hono().post(
  '/dev/mock-chat',
  async (c) => {
    const body = (await c.req
      .json()
      .catch(() => null)) as MockChatRequestBody | null;
    const echoed = lastUserText(body);

    if (echoed.includes('409')) {
      return c.json(
        {
          code: 'DUPLICATE_CLIENT_MESSAGE',
          message: 'This message has already been submitted. (mock)',
          details: { existingMessageId: 'msg_mock_duplicate' },
        },
        409,
      );
    }

    const reply = echoed
      ? `（模拟回复，无需 LLM Key）你说的是：“${echoed}”。这条消息来自 /api/dev/mock-chat 的流式验证。`
      : '（模拟回复）这是一条无需 LLM Key 的流式验证消息。';

    const stateData: AgentStateEventData = { event: mockStateEvent(echoed) };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // 协议要求：状态事件先于文本增量
        writer.write({
          type: 'data-agent-state-event',
          data: stateData,
          id: stateData.event.id,
        });

        for (const chunk of reply.match(/[\s\S]{1,6}/gu) ?? []) {
          writer.write({ type: 'text-delta', id: 'mock-reply', delta: chunk });
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
      },
    });

    return createUIMessageStreamResponse({ stream });
  },
);