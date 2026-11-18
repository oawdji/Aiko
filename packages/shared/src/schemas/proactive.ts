import { z } from 'zod';

export const ProactiveStrategySchema = z.enum([
  'emotion_care',
  'memory_recall',
  'curious_question',
]);
export type ProactiveStrategy = z.infer<typeof ProactiveStrategySchema>;

/** POST /api/proactive/evaluate 请求体（前端空闲计时器触发时调用）。 */
export const ProactiveEvaluateBodySchema = z.object({
  agentId: z.string().optional(),
  conversationId: z.string().min(1),
  /** 客户端本地当天的分钟数（0–1439），用于免打扰窗口判断 */
  localMinutesOfDay: z.number().int().min(0).max(1439),
});
export type ProactiveEvaluateBody = z.infer<typeof ProactiveEvaluateBodySchema>;

export const ProactiveMessageInfoSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  content: z.string(),
  strategy: ProactiveStrategySchema,
  createdAt: z.string(),
});

/** evaluate 响应：send=false 时 message 为 null（无状态、不补发）。 */
export const ProactiveEvaluateResponseSchema = z.object({
  send: z.boolean(),
  reason: z.string().nullable(),
  message: z
    .object({
      id: z.string(),
      conversationId: z.string(),
      content: z.string(),
      strategy: ProactiveStrategySchema,
      createdAt: z.string(),
    })
    .nullable(),
});
export type ProactiveEvaluateResponse = z.infer<typeof ProactiveEvaluateResponseSchema>;

/** 命中策略时返回的单条主动消息（hook 注入聊天流使用）。 */
export type ProactiveMessageInfo = NonNullable<ProactiveEvaluateResponse['message']>;

/** GET /api/proactive/history 响应（含正文，供历史查看）。 */
export const ProactiveHistoryResponseSchema = z.object({
  messages: z.array(
    z.object({
      id: z.string(),
      conversationId: z.string(),
      strategy: ProactiveStrategySchema,
      evidenceText: z.string(),
      createdAt: z.string(),
      content: z.string(),
    }),
  ),
});
export type ProactiveHistoryResponse = z.infer<typeof ProactiveHistoryResponseSchema>;
