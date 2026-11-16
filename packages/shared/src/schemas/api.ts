import { z } from 'zod';

import { AgentEmotionStateSchema } from './emotion';

// ---------------------------------------------------------------------------
// 基础枚举与标量
// ---------------------------------------------------------------------------

export const ChatMessageRoleSchema = z.enum(['user', 'assistant', 'system']);
export type ChatMessageRole = z.infer<typeof ChatMessageRoleSchema>;

export const ChatMessageStatusSchema = z.enum(['streaming', 'complete', 'failed']);
export type ChatMessageStatus = z.infer<typeof ChatMessageStatusSchema>;

export const EmotionTagSchema = z.enum([
  'calm',
  'curious',
  'happy',
  'low',
  'tense',
  'neutral',
]);
export type EmotionTag = z.infer<typeof EmotionTagSchema>;

export const AgentStateEventSourceSchema = z.enum([
  'user_message',
  'assistant_message',
  'time_decay',
  'manual',
]);
export type AgentStateEventSource = z.infer<typeof AgentStateEventSourceSchema>;

/** ISO 8601 UTC 字符串，见 api-contract.md §2.5 */
export const IsoDateTimeSchema = z.string().datetime({ offset: false });

// ---------------------------------------------------------------------------
// 核心实体 DTO
// ---------------------------------------------------------------------------

export const ChatMessageDTOSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  agentId: z.string().min(1),
  role: ChatMessageRoleSchema,
  content: z.string().min(1),
  status: ChatMessageStatusSchema,
  errorCode: z.string().min(1).nullable(),
  createdAt: IsoDateTimeSchema,
});

export const ConversationDTOSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  title: z.string().nullable(),
  lastMessageAt: IsoDateTimeSchema.nullable(),
  isArchived: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const AgentDTOSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().nullable(),
  currentState: AgentEmotionStateSchema,
  currentTag: EmotionTagSchema,
  stateUpdatedAt: IsoDateTimeSchema.nullable(),
  /** 角色气质基线 μ（只读，衰减回归目标，见 technical-design.md §10.11） */
  emotionBaseline: AgentEmotionStateSchema,
  /** 基线回归半程时间（小时，只读；null = 使用全局默认） */
  decayHalfLifeHours: z.number().positive().nullable(),
  personaVersion: z.number().int().min(1),
});

export const AgentStateEventSchema = z
  .object({
    id: z.string().min(1),
    agentId: z.string().min(1),
    conversationId: z.string().min(1),
    triggerMessageId: z.string().min(1).nullable(),
    source: AgentStateEventSourceSchema,
    ruleVersion: z.string().min(1),
    before: AgentEmotionStateSchema,
    delta: AgentEmotionStateSchema,
    after: AgentEmotionStateSchema,
    discreteTag: EmotionTagSchema,
    reason: z.string().min(1),
    evidenceText: z.string(),
    confidence: z.number().min(0).max(1),
    createdAt: IsoDateTimeSchema,
  })
  .superRefine((event, ctx) => {
    if (
      (event.source === 'user_message' || event.source === 'assistant_message') &&
      event.triggerMessageId === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['triggerMessageId'],
        message: 'triggerMessageId must be non-null for message-triggered events',
      });
    }
  });

// ---------------------------------------------------------------------------
// 设置与 LLM 连接
// ---------------------------------------------------------------------------

export const AppThemeSchema = z.enum(['light', 'dark', 'system']);
export type AppTheme = z.infer<typeof AppThemeSchema>;

export const AppSettingsSchema = z
  .object({
    defaultAgentId: z.string().min(1),
    recentWindowRounds: z.number().int().min(10).max(15),
    maxContextMessages: z.number().int().min(20).max(30),
    theme: AppThemeSchema,
  })
  .refine(
    (settings) => settings.maxContextMessages === settings.recentWindowRounds * 2,
    {
      message: 'maxContextMessages must equal recentWindowRounds * 2',
    },
  );

export const LlmConnectionInfoSchema = z
  .object({
    baseUrl: z.string().url(),
    model: z.string().min(1),
    apiKeyConfigured: z.boolean(),
    apiKeyHint: z.string().nullable(),
  })
  .refine(
    (info) => info.apiKeyConfigured || info.apiKeyHint === null,
    {
      message: 'apiKeyHint must be null when apiKeyConfigured is false',
    },
  );

export const UpdateSettingsRequestBodySchema = z
  .object({
    theme: AppThemeSchema.optional(),
    recentWindowRounds: z.number().int().min(10).max(15).optional(),
    maxContextMessages: z.number().int().min(20).max(30).optional(),
    llmBaseUrl: z.string().url().optional(),
    llmModel: z.string().min(1).optional(),
    llmApiKey: z.string().min(1).nullable().optional(),
  })
  .refine(
    (body) =>
      body.recentWindowRounds === undefined ||
      body.maxContextMessages === undefined ||
      body.maxContextMessages === body.recentWindowRounds * 2,
    {
      message: 'maxContextMessages must equal recentWindowRounds * 2',
    },
  );

// ---------------------------------------------------------------------------
// 错误结构
// ---------------------------------------------------------------------------

export const ApiErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'AGENT_NOT_FOUND',
  'CONVERSATION_NOT_FOUND',
  'MEM_NOT_FOUND',
  'INVALID_TRANSITION',
  'DUPLICATE_CLIENT_MESSAGE',
  'CONFLICT',
  'MESSAGE_TOO_LONG',
  'RULE_VERSION_MISMATCH',
  'RATE_LIMITED',
  'LLM_REQUEST_FAILED',
  'INTERNAL_ERROR',
]);

export const ApiErrorSchema = z.object({
  code: ApiErrorCodeSchema,
  message: z.string().min(1),
  details: z.unknown().optional(),
});

// ---------------------------------------------------------------------------
// 分页
// ---------------------------------------------------------------------------

/** 会话消息分页上限，见 api-contract.md §8.2 */
export const MESSAGE_PAGE_LIMIT_MIN = 1;
export const MESSAGE_PAGE_LIMIT_MAX = 100;
export const MESSAGE_PAGE_LIMIT_DEFAULT = 30;

/** 状态事件分页上限，见 api-contract.md §10.2 */
export const STATE_EVENT_PAGE_LIMIT_MIN = 1;
export const STATE_EVENT_PAGE_LIMIT_MAX = 200;
export const STATE_EVENT_PAGE_LIMIT_DEFAULT = 50;

export const MessagePageQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(MESSAGE_PAGE_LIMIT_MIN)
    .max(MESSAGE_PAGE_LIMIT_MAX)
    .optional(),
  beforeId: z.string().min(1).optional(),
});

export const StateEventPageQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(STATE_EVENT_PAGE_LIMIT_MIN)
    .max(STATE_EVENT_PAGE_LIMIT_MAX)
    .optional(),
  beforeId: z.string().min(1).optional(),
});

export interface PageDTO<T> {
  items: T[];
  nextPage: {
    limit: number;
    beforeId: string;
  } | null;
}

// ---------------------------------------------------------------------------
// 响应 DTO
// ---------------------------------------------------------------------------

export const BootstrapResponseSchema = z.object({
  user: z.object({ id: z.string().min(1) }),
  agent: AgentDTOSchema,
  conversation: ConversationDTOSchema,
  messages: z.array(ChatMessageDTOSchema),
  latestStateEvent: AgentStateEventSchema.nullable(),
  settings: AppSettingsSchema,
});

export const ConversationDetailResponseSchema = z.object({
  conversation: ConversationDTOSchema,
  agent: AgentDTOSchema,
  messages: z.array(ChatMessageDTOSchema),
  latestStateEvent: AgentStateEventSchema.nullable(),
  nextPage: z
    .object({
      limit: z.number().int().min(MESSAGE_PAGE_LIMIT_MIN).max(MESSAGE_PAGE_LIMIT_MAX),
      beforeId: z.string().min(1),
    })
    .nullable(),
});

export const AgentStateResponseSchema = z.object({
  agentId: z.string().min(1),
  state: AgentEmotionStateSchema,
  discreteTag: EmotionTagSchema,
  stateUpdatedAt: IsoDateTimeSchema.nullable(),
});

export const StateEventPageResponseSchema = z.object({
  items: z.array(AgentStateEventSchema),
  nextPage: z
    .object({
      limit: z.number().int().min(STATE_EVENT_PAGE_LIMIT_MIN).max(STATE_EVENT_PAGE_LIMIT_MAX),
      beforeId: z.string().min(1),
    })
    .nullable(),
});

export const SettingsResponseSchema = z.object({
  settings: AppSettingsSchema,
  llm: LlmConnectionInfoSchema,
});

export const LlmConnectionTestResponseSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().min(0),
  errorCode: z.string().min(1).nullable(),
});

// ---------------------------------------------------------------------------
// 静态类型（由 schema 推导，保证类型与校验规则一致）
// ---------------------------------------------------------------------------

export type ChatMessageDTO = z.infer<typeof ChatMessageDTOSchema>;
export type ConversationDTO = z.infer<typeof ConversationDTOSchema>;
export type AgentDTO = z.infer<typeof AgentDTOSchema>;
export type AgentStateEvent = z.infer<typeof AgentStateEventSchema>;
export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type LlmConnectionInfo = z.infer<typeof LlmConnectionInfoSchema>;
export type UpdateSettingsRequestBody = z.infer<typeof UpdateSettingsRequestBodySchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type BootstrapResponse = z.infer<typeof BootstrapResponseSchema>;
export type ConversationDetailResponse = z.infer<typeof ConversationDetailResponseSchema>;
export type AgentStateResponse = z.infer<typeof AgentStateResponseSchema>;
export type StateEventPageResponse = z.infer<typeof StateEventPageResponseSchema>;
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;
export type LlmConnectionTestResponse = z.infer<typeof LlmConnectionTestResponseSchema>;
// ---------------------------------------------------------------------------
// 健康检查（内部运维端点，非对外契约）
// ---------------------------------------------------------------------------

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  service: z.string().min(1),
  db: z.enum(['ok', 'error']),
  time: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;