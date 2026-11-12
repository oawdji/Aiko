import { DEFAULT_AGENT_ID } from '@aiko/shared';
import type { ChatMessageDTO } from '@aiko/shared';

/**
 * Phase 0 验证夹具：模拟 bootstrap 恢复的历史消息。
 * M2 接入 GET /api/bootstrap 后，此文件将被真实数据取代并删除。
 */
export const RESTORED_MESSAGES: ChatMessageDTO[] = [
  {
    id: 'msg_demo_0001',
    conversationId: 'conv_demo',
    agentId: DEFAULT_AGENT_ID,
    role: 'user',
    content: '你好，还记得昨天聊到我在学做饭吗？',
    status: 'complete',
    errorCode: null,
    createdAt: '2026-11-10T08:00:00.000Z',
  },
  {
    id: 'msg_demo_0002',
    conversationId: 'conv_demo',
    agentId: DEFAULT_AGENT_ID,
    role: 'assistant',
    content: '记得呀，你说想先从家常菜开始，这周打算试试番茄炒蛋。',
    status: 'complete',
    errorCode: null,
    createdAt: '2026-11-10T08:00:05.000Z',
  },
  {
    id: 'msg_demo_0003',
    conversationId: 'conv_demo',
    agentId: DEFAULT_AGENT_ID,
    role: 'user',
    content: '对，今天想聊聊别的。',
    status: 'complete',
    errorCode: null,
    createdAt: '2026-11-10T08:01:00.000Z',
  },
];