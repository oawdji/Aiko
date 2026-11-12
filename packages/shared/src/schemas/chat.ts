import { z } from 'zod';

/** 消息长度上限，按 JavaScript UTF-16 长度统计（api-contract.md §17.3）。 */
export const CHAT_MESSAGE_MAX_LENGTH = 8000;

/**
 * POST /api/chat 请求体（api-contract.md §13.2/§13.4）。
 * 前端 client 与服务端 route 共用，防止两侧校验规则漂移。
 */
export const ChatRequestBodySchema = z.object({
  agentId: z.string().trim().min(1),
  conversationId: z.string().trim().min(1),
  message: z
    .string()
    .refine((value) => value.trim().length >= 1, {
      message: 'message must not be empty after trim',
    })
    .refine((value) => value.length <= CHAT_MESSAGE_MAX_LENGTH, {
      message: `message must be at most ${CHAT_MESSAGE_MAX_LENGTH} characters`,
    }),
  clientMessageId: z.string().trim().min(1),
});

export type ChatRequestBody = z.infer<typeof ChatRequestBodySchema>;