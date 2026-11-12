import { randomUUID } from 'node:crypto';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import {
  LOCAL_USER_ID,
  AgentDTOSchema,
  AppSettingsSchema,
  BootstrapResponseSchema,
  ChatMessageDTOSchema,
  ConversationDTOSchema,
  type BootstrapResponse,
} from '@aiko/shared';
import type { DbHandle } from '../db/client';
import {
  agents,
  appSettings,
  conversations,
  messages,
  stateEvents,
} from '../db/schema';

/** Bootstrap 恢复的消息窗口，见 api-contract.md §7.5。 */
export const BOOTSTRAP_MESSAGE_LIMIT = 30;

export class AgentNotFoundError extends Error {
  constructor(agentRef: string) {
    super(`Agent not found: ${agentRef}`);
    this.name = 'AgentNotFoundError';
  }
}

/**
 * M2.2 Bootstrap 领域服务：
 * - 读取或创建最近活跃会话（活跃 = 未归档，按 lastMessageAt/updatedAt 取最新）；
 * - 返回最近 30 条消息（升序）；
 * - 返回 Agent 最新一条状态事件（同毫秒按 id 倒序稳定排序）；
 * - 返回本地设置。
 * route 层只做参数解析与错误映射，不接触 SQL；本层不做 HTTP 概念。
 */
export function bootstrapAgent(handle: DbHandle, agentRef: string, now: string): BootstrapResponse {
  const { db } = handle;

  const agent = db
    .select()
    .from(agents)
    .where(or(eq(agents.slug, agentRef), eq(agents.id, agentRef)))
    .get();
  if (!agent) {
    throw new AgentNotFoundError(agentRef);
  }

  let conversation = db
    .select()
    .from(conversations)
    .where(and(eq(conversations.agentId, agent.id), eq(conversations.isArchived, 0)))
    .orderBy(sql`COALESCE(${conversations.lastMessageAt}, ${conversations.updatedAt}) DESC`, desc(conversations.id))
    .get();

  if (!conversation) {
    db.insert(conversations)
      .values({
        id: `conv_${randomUUID()}`,
        userId: LOCAL_USER_ID,
        agentId: agent.id,
        title: null,
        lastMessageAt: null,
        isArchived: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    conversation = db
      .select()
      .from(conversations)
      .where(and(eq(conversations.agentId, agent.id), eq(conversations.isArchived, 0)))
      .orderBy(sql`COALESCE(${conversations.lastMessageAt}, ${conversations.updatedAt}) DESC`, desc(conversations.id))
      .get();
  }

  if (!conversation) {
    throw new Error('bootstrap: conversation disappeared after creation');
  }

  // 倒序取最近窗口后反转为升序，利用 messages_conversation_created_idx。
  const recentMessages = db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversation.id))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(BOOTSTRAP_MESSAGE_LIMIT)
    .all()
    .reverse();

  const latestStateEvent = db
    .select()
    .from(stateEvents)
    .where(eq(stateEvents.agentId, agent.id))
    .orderBy(desc(stateEvents.createdAt), desc(stateEvents.id))
    .get();

  const settings = readAppSettings(handle);

  return BootstrapResponseSchema.parse({
    user: { id: LOCAL_USER_ID },
    agent: AgentDTOSchema.parse({
      id: agent.id,
      slug: agent.slug,
      displayName: agent.displayName,
      description: agent.description,
      currentState: {
        valence: agent.currentValence,
        arousal: agent.currentArousal,
      },
      currentTag: agent.currentTag,
      stateUpdatedAt: agent.stateUpdatedAt,
      personaVersion: agent.activePersonaVersion,
    }),
    conversation: ConversationDTOSchema.parse({
      id: conversation.id,
      agentId: conversation.agentId,
      title: conversation.title,
      lastMessageAt: conversation.lastMessageAt,
      isArchived: conversation.isArchived === 1,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    }),
    messages: recentMessages.map((row) =>
      ChatMessageDTOSchema.parse({
        id: row.id,
        conversationId: row.conversationId,
        agentId: row.agentId,
        role: row.role,
        content: row.content,
        status: row.status,
        errorCode: row.errorCode,
        createdAt: row.createdAt,
      }),
    ),
    latestStateEvent: latestStateEvent
      ? parseStateEventRow(latestStateEvent)
      : null,
    settings,
  });
}

/** 从 app_settings 键值表读取并组装 AppSettings（seed 保证键存在）。 */
export function readAppSettings(handle: DbHandle) {
  const rows = handle.db.select().from(appSettings).all();
  const values = new Map(rows.map((row) => [row.key, JSON.parse(row.valueJson)]));

  return AppSettingsSchema.parse({
    defaultAgentId: values.get('default_agent_id'),
    recentWindowRounds: values.get('recent_window_rounds'),
    maxContextMessages: values.get('max_context_messages'),
    theme: values.get('theme'),
  });
}

/** snake_case 行 → camelCase DTO（state_events 专用）。 */
export function parseStateEventRow(row: {
  id: string;
  agentId: string;
  conversationId: string;
  triggerMessageId: string | null;
  source: string;
  ruleVersion: string;
  beforeValence: number;
  beforeArousal: number;
  deltaValence: number;
  deltaArousal: number;
  afterValence: number;
  afterArousal: number;
  discreteTag: string;
  reason: string;
  evidenceText: string;
  confidence: number;
  createdAt: string;
}) {
  return {
    id: row.id,
    agentId: row.agentId,
    conversationId: row.conversationId,
    triggerMessageId: row.triggerMessageId,
    source: row.source,
    ruleVersion: row.ruleVersion,
    before: { valence: row.beforeValence, arousal: row.beforeArousal },
    delta: { valence: row.deltaValence, arousal: row.deltaArousal },
    after: { valence: row.afterValence, arousal: row.afterArousal },
    discreteTag: row.discreteTag,
    reason: row.reason,
    evidenceText: row.evidenceText,
    confidence: row.confidence,
    createdAt: row.createdAt,
  };
}