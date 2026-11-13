import { z } from 'zod';

/** 记忆类型（F15） */
export const MemoryTypeSchema = z.enum([
  'fact',
  'preference',
  'goal',
  'episode',
  'relationship',
]);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

/** 记忆状态流转：candidate -> active/rejected；active -> outdated/deleted；outdated -> active/deleted */
export const MemoryStatusSchema = z.enum([
  'candidate',
  'active',
  'outdated',
  'rejected',
  'deleted',
]);
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;

export const MemoryPadSchema = z.object({
  v: z.number().min(-1).max(1),
  a: z.number().min(-1).max(1),
  d: z.number().min(-1).max(1),
});
export type MemoryPad = z.infer<typeof MemoryPadSchema>;

/** 单条长期记忆 DTO（对外契约，不含内部检索字段） */
export const MemoryFactDTOSchema = z.object({
  id: z.string(),
  userId: z.string(),
  agentId: z.string(),
  type: MemoryTypeSchema,
  content: z.string(),
  sourceMessageId: z.string(),
  confidence: z.number().min(0).max(1),
  status: MemoryStatusSchema,
  memoryPad: MemoryPadSchema,
  arousal: z.number().min(0).max(1),
  halfLifeHours: z.number().positive(),
  strength: z.number().min(0).max(1),
  lastAccessedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MemoryFactDTO = z.infer<typeof MemoryFactDTOSchema>;

/** GET /api/memories 查询参数 */
export const MemoryListQuerySchema = z.object({
  status: MemoryStatusSchema.optional(),
  type: MemoryTypeSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});
export type MemoryListQuery = z.infer<typeof MemoryListQuerySchema>;

/** GET /api/memories 响应 */
export const MemoryListResponseSchema = z.object({
  memories: z.array(MemoryFactDTOSchema),
});
export type MemoryListResponse = z.infer<typeof MemoryListResponseSchema>;

/** PATCH /api/memories/:id 请求体（修正内容与类型，F17） */
export const MemoryPatchBodySchema = z.object({
  content: z.string().min(1).optional(),
  type: MemoryTypeSchema.optional(),
});
export type MemoryPatchBody = z.infer<typeof MemoryPatchBodySchema>;

/** 会话摘要 DTO（F14） */
export const ConversationSummaryDTOSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  agentId: z.string(),
  startMessageId: z.string(),
  endMessageId: z.string(),
  content: z.string(),
  status: z.enum(['pending', 'ready', 'failed', 'deleted']),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConversationSummaryDTO = z.infer<typeof ConversationSummaryDTOSchema>;

/** 非法状态流转错误（service 层契约，route 映射为 409） */
export class InvalidMemoryTransitionError extends Error {
  constructor(
    readonly memoryId: string,
    readonly from: MemoryStatus,
    readonly to: MemoryStatus,
  ) {
    super(
      `Invalid memory status transition for ${memoryId}: ${from} -> ${to}`,
    );
    this.name = 'InvalidMemoryTransitionError';
  }
}
