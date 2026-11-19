import { z } from 'zod';

import { AgentEmotionStateSchema } from './emotion';
import { ConversationSummaryDTOSchema } from './memory';

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

export const ChatMessageMetadataSchema = z
  .object({
    proactive: z.boolean().optional(),
    strategy: z.string().optional(),
  })
  .optional();
export type ChatMessageMetadata = z.infer<typeof ChatMessageMetadataSchema>;

export const ChatMessageDTOSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  agentId: z.string().min(1),
  role: ChatMessageRoleSchema,
  content: z.string().min(1),
  status: ChatMessageStatusSchema,
  errorCode: z.string().min(1).nullable(),
  createdAt: IsoDateTimeSchema,
  /** 主动消息标记（Phase 4，可选新增字段） */
  metadata: ChatMessageMetadataSchema,
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

/** 历史列表中的一条会话。preview 是首条用户消息的短摘要，没有则为 null。 */
export const ConversationListItemSchema = ConversationDTOSchema.extend({
  preview: z.string().min(1).nullable(),
});

export const ConversationListQuerySchema = z.object({
  agentId: z.string().min(1).optional(),
});

export const ConversationListResponseSchema = z.object({
  items: z.array(ConversationListItemSchema),
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

const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const ProactiveSettingsSchema = z.object({
  enabled: z.boolean(),
  idleMinutes: z.number().int().min(1).max(1440),
  maxPer24h: z.number().int().min(1).max(50),
  quietStart: z.string().regex(HHMM_PATTERN),
  quietEnd: z.string().regex(HHMM_PATTERN),
  minIntervalMinutes: z.number().int().min(0).max(1440),
});
export type ProactiveSettings = z.infer<typeof ProactiveSettingsSchema>;

export const AppSettingsSchema = z
  .object({
    defaultAgentId: z.string().min(1),
    recentWindowRounds: z.number().int().min(10).max(15),
    maxContextMessages: z.number().int().min(20).max(30),
    theme: AppThemeSchema,
    proactive: ProactiveSettingsSchema,
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
    proactive: ProactiveSettingsSchema.partial().optional(),
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
  'REGENERATE_NOT_APPLICABLE',
  'PLUGIN_NOT_FOUND',
  'SUMMARY_NOT_FOUND',
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
  // 受控人格演化（P3）
  'PERSONA_PROPOSAL_NOT_FOUND',
  'PERSONA_VERSION_NOT_FOUND',
  'PERSONA_PROPOSAL_STATE',
  'PERSONA_BASE_CHANGED',
  'PERSONA_RATE_LIMITED',
  'PERSONA_PATCH_INVALID',
  'PERSONA_NO_ACTIVE',
  'PERSONA_CORE_INVALID',
  // Phase 4 主动行为
  'PROACTIVE_CONVERSATION_NOT_FOUND',
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

/** 语义检索可用性状态（透明降级）：unverified=尚未经过真实调用验证。 */
export const MemoryRetrievalStatusSchema = z.object({
  state: z.enum(['unverified', 'ok', 'degraded']),
  reason: z.string().nullable(),
});

export const SettingsResponseSchema = z.object({
  settings: AppSettingsSchema,
  llm: LlmConnectionInfoSchema,
  memory: MemoryRetrievalStatusSchema.optional(),
});

export const LlmConnectionTestResponseSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().min(0),
  errorCode: z.string().min(1).nullable(),
});

// ---------------------------------------------------------------------------
// 插件（Phase 2：清单 / 启停）
// ---------------------------------------------------------------------------

export const PluginMountPointSchema = z.enum([
  'context-contributor',
  'proactive-strategy',
  'emotion-extractor',
  'memory-retriever',
]);
export type PluginMountPoint = z.infer<typeof PluginMountPointSchema>;

export const PluginInfoSchema = z.object({
  id: z.string().min(1),
  mountPoint: PluginMountPointSchema,
  description: z.string().nullable(),
  /** context-contributor 的排序字段 */
  order: z.number().int().optional(),
  /** proactive-strategy 的优先级字段 */
  priority: z.number().int().optional(),
  enabled: z.boolean(),
});
export type PluginInfo = z.infer<typeof PluginInfoSchema>;

export const PluginUiLinkSchema = z.object({
  pluginId: z.string().min(1),
  label: z.string().min(1),
  url: z.string().min(1),
});
export type PluginUiLink = z.infer<typeof PluginUiLinkSchema>;

export const PluginListResponseSchema = z.object({
  plugins: z.array(PluginInfoSchema),
  /** 声明式前端插槽：插件提供的工具链接（禁用插件的链接会被过滤） */
  uiLinks: z.array(PluginUiLinkSchema).optional(),
});
export type PluginListResponse = z.infer<typeof PluginListResponseSchema>;

export const PluginUpdateRequestSchema = z.object({
  enabled: z.boolean(),
});
export type PluginUpdateRequest = z.infer<typeof PluginUpdateRequestSchema>;

// ---------------------------------------------------------------------------
// 会话摘要（透明性：摘要对用户可见可删除）
// ---------------------------------------------------------------------------

export const SummaryListQuerySchema = z.object({
  conversationId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type SummaryListQuery = z.infer<typeof SummaryListQuerySchema>;

export const SummaryListResponseSchema = z.object({
  items: z.array(ConversationSummaryDTOSchema),
  total: z.number().int().min(0),
});
export type SummaryListResponse = z.infer<typeof SummaryListResponseSchema>;

export const SummaryDeleteResponseSchema = z.object({
  ok: z.literal(true),
  deletedAt: IsoDateTimeSchema,
});
export type SummaryDeleteResponse = z.infer<typeof SummaryDeleteResponseSchema>;

/** POST /api/conversations 请求体（手动新建会话） */
export const ConversationCreateRequestSchema = z.object({
  agentId: z.string().min(1),
});
export type ConversationCreateRequest = z.infer<typeof ConversationCreateRequestSchema>;

/** POST /api/conversations 响应 */
export const ConversationCreateResponseSchema = z.object({
  conversation: ConversationDTOSchema,
});

/** DELETE /api/conversations[/:id] 响应（会话删除/清空） */
export const ConversationDeleteResponseSchema = z.object({
  ok: z.literal(true),
  deletedAt: z.string(),
  count: z.number().int().min(0),
});

// ---------------------------------------------------------------------------
// 静态类型（由 schema 推导，保证类型与校验规则一致）
// ---------------------------------------------------------------------------

export type ChatMessageDTO = z.infer<typeof ChatMessageDTOSchema>;
export type ConversationDTO = z.infer<typeof ConversationDTOSchema>;
export type ConversationListItem = z.infer<typeof ConversationListItemSchema>;
export type ConversationListResponse = z.infer<typeof ConversationListResponseSchema>;
export type ConversationDeleteResponse = z.infer<typeof ConversationDeleteResponseSchema>;
export type ConversationCreateResponse = z.infer<typeof ConversationCreateResponseSchema>;
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
export type MemoryRetrievalStatus = z.infer<typeof MemoryRetrievalStatusSchema>;
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