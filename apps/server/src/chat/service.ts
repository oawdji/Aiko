import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessageChunk,
} from 'ai';
import {
  LOCAL_USER_ID,
  type AgentEmotionState,
  type EmotionTag,
  type ChatRequestBody,
} from '@aiko/shared';
import { getChatModel } from '../llm/provider';
import { resolveEffectiveLlmSettings } from '../settings/service';
import type { DbHandle } from '../db/client';
import { PERSONA_CORE_MD } from '../db/generated/persona-core';
import { getActivePersona } from '../persona/repository';
import { renderPersonaStyleSection } from '../persona/render';
import { looksLikeStyleAdjustment } from '../persona/intent';
import { agents, conversations, messages, stateEvents } from '../db/schema';
import { type PromptMessage } from './recent-window';
import {
  EMOTION_EXTRACTION_VERSION,
  applyEmotion,
  buildExtraction,
  computeTag,
  isEmotionEngineEnabled,
  type EmotionExtraction,
} from './emotion-llm';
import { computeDisplayState, resolveDecayConfig, revertToBaseline } from './emotion-decay';
import {
  runContextContributors,
} from '../plugins/context-contributors';
import { getDefaultEmotionExtractor } from '../plugins/emotion-extractors';
import { getDefaultMemoryRetriever } from '../plugins/retriever';
import { loadMemoryConfig } from '../config/memory';
import type { MemoryClient } from './memory-client';
import { scheduleFactExtraction } from '../extraction/pipeline';
import { searchMemories, updateLastAccessed } from '../memories/retrieval';
import { maybeTriggerSummary, reconsolidateHits, runSummaryTask } from '../memories/lifecycle';
import { isDebugModeEnabled } from '../settings/service';
import { promptSnapshots } from '../db/schema';
import type { CompleteFn } from '../extraction/types';

export type { MemoryClient };

export class ChatAgentNotFoundError extends Error {
  constructor(agentRef: string) {
    super(`Agent not found: ${agentRef}`);
    this.name = 'ChatAgentNotFoundError';
  }
}

export class ChatConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`Conversation not found or not owned by agent: ${conversationId}`);
    this.name = 'ChatConversationNotFoundError';
  }
}

export class DuplicateClientMessageError extends Error {
  readonly existingMessageId: string;

  constructor(existingMessageId: string) {
    super('This message has already been submitted.');
    this.name = 'DuplicateClientMessageError';
    this.existingMessageId = existingMessageId;
  }
}

/** LLM 调用失败（含未配置 Key），契约 §15.2：保留用户消息与状态事件，写 failed 占位。 */
export class LlmRequestFailedError extends Error {
  constructor(detail?: string) {
    super(detail ?? 'LLM request failed');
    this.name = 'LlmRequestFailedError';
  }
}

export type PersistedUserMessage = {
  messageId: string;
  conversationId: string;
  agentId: string;
};

export type ChatStateEventData = {
  id: string;
  triggerMessageId: string;
  before: AgentEmotionState;
  delta: AgentEmotionState;
  after: AgentEmotionState;
  discreteTag: string;
  reason: string;
  evidenceText: string;
  confidence: number;
};

export type ChatPipelineResult = {
  agentId: string;
  conversationId: string;
  userMessageId: string;
  userMessage: string;
  memory: MemoryClient | null;
  llm: LlmStreamHandle;
  /** 聊天前独立抽取已落库的状态事件（可能为 null = 引擎关/抽取失败降级）。 */
  stateEvent: ChatStateEventData | null;
  /** fire-and-forget 的事实抽取 promise，route 不 await；仅测试用 */
  memoryExtraction?: Promise<number>;
};

/** LLM 结果抽象：真实 streamText 与测试 fake 都满足此形状。 */
export type LlmStreamHandle = {
  text: PromiseLike<string>;
  toUimessageStream: () => ReadableStream<UIMessageChunk> | AsyncIterable<UIMessageChunk>;
};

export type EmotionExtractor = (
  userMessage: string,
  recent: PromptMessage[],
) => Promise<{ tag: string; intensity: number; reason: string } | null>;

export type LlmStreamFactory = (prompt: {
  system: string;
  messages: PromptMessage[];
}) => LlmStreamHandle;

function findExistingMessage(
  handle: DbHandle,
  conversationId: string,
  clientMessageId: string,
): { id: string } | undefined {
  return handle.db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.clientMessageId, clientMessageId),
      ),
    )
    .get();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

/** M3.2：校验 Agent/会话归属 → 事务写入用户消息（幂等）→ 更新会话活跃时间。 */
export function persistUserMessage(
  handle: DbHandle,
  body: ChatRequestBody,
  now: string,
): PersistedUserMessage {
  const { db } = handle;

  const agent =
    db.select().from(agents).where(eq(agents.id, body.agentId)).get() ??
    db.select().from(agents).where(eq(agents.slug, body.agentId)).get();
  if (!agent) {
    throw new ChatAgentNotFoundError(body.agentId);
  }

  const conversation = db
    .select()
    .from(conversations)
    .where(eq(conversations.id, body.conversationId))
    .get();
  if (!conversation || conversation.agentId !== agent.id) {
    throw new ChatConversationNotFoundError(body.conversationId);
  }

  const existing = findExistingMessage(handle, conversation.id, body.clientMessageId);
  if (existing) {
    throw new DuplicateClientMessageError(existing.id);
  }

  const messageId = `msg_${randomUUID()}`;
  try {
    handle.sqlite.transaction(() => {
      db.insert(messages)
        .values({
          id: messageId,
          conversationId: conversation.id,
          agentId: agent.id,
          userId: LOCAL_USER_ID,
          role: 'user',
          content: body.message,
          status: 'complete',
          clientMessageId: body.clientMessageId,
          errorCode: null,
          metadataJson: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      db.update(conversations)
        .set({ lastMessageAt: now, updatedAt: now })
        .where(eq(conversations.id, conversation.id))
        .run();
    })();
  } catch (error) {
    if (isUniqueViolation(error)) {
      const row = findExistingMessage(handle, conversation.id, body.clientMessageId);
      throw new DuplicateClientMessageError(row?.id ?? messageId);
    }
    throw error;
  }

  return { messageId, conversationId: conversation.id, agentId: agent.id };
}

/** 状态事件落库并更新 agent 快照（含读时回归 → delta → 三维快照写入）。 */
export function applyStateEvent(
  handle: DbHandle,
  params: {
    agentId: string;
    conversationId: string;
    triggerMessageId: string;
    extraction: EmotionExtraction;
    now: string;
  },
): ChatStateEventData {
  const { db } = handle;

  const agent = db.select().from(agents).where(eq(agents.id, params.agentId)).get();
  if (!agent) {
    throw new ChatAgentNotFoundError(params.agentId);
  }

  const before = revertToBaseline(
    { valence: agent.currentValence, arousal: agent.currentArousal, dominance: agent.currentDominance },
    { valence: agent.baselineValence, arousal: agent.baselineArousal, dominance: agent.baselineDominance },
    agent.stateUpdatedAt
      ? (Date.parse(params.now) - Date.parse(agent.stateUpdatedAt)) / 3_600_000
      : 0,
    resolveDecayConfig(agent.decayHalfLifeHours),
  );
  const { after, delta } = applyEmotion(before, params.extraction);
  const discreteTag = computeTag(after);
  const id = `state_${randomUUID()}`;

  handle.sqlite.transaction(() => {
    db.insert(stateEvents)
      .values({
        id,
        agentId: params.agentId,
        conversationId: params.conversationId,
        triggerMessageId: params.triggerMessageId,
        source: 'user_message',
        ruleVersion: EMOTION_EXTRACTION_VERSION,
        beforeValence: before.valence,
        beforeArousal: before.arousal,
        beforeDominance: before.dominance,
        deltaValence: delta.valence,
        deltaArousal: delta.arousal,
        deltaDominance: delta.dominance,
        afterValence: after.valence,
        afterArousal: after.arousal,
        afterDominance: after.dominance,
        discreteTag,
        reason: params.extraction.reason,
        evidenceText: params.extraction.evidenceText,
        confidence: params.extraction.confidence,
        createdAt: params.now,
      })
      .run();

    db.update(agents)
      .set({
        currentValence: after.valence,
        currentArousal: after.arousal,
        currentDominance: after.dominance,
        currentTag: discreteTag,
        stateUpdatedAt: params.now,
        updatedAt: params.now,
      })
      .where(eq(agents.id, params.agentId))
      .run();
  })();

  return {
    id,
    triggerMessageId: params.triggerMessageId,
    before,
    delta,
    after,
    discreteTag,
    reason: params.extraction.reason,
    evidenceText: params.extraction.evidenceText,
    confidence: params.extraction.confidence,
  };
}

/** 数据库近期窗口。 */
export function loadRecentWindow(handle: DbHandle, conversationId: string, limit: number): PromptMessage[] {
  return handle.db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.status, 'complete')))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit)
    .all()
    .reverse()
    .map((row) => ({ role: row.role === 'assistant' ? 'assistant' : 'user', content: row.content }));
}

function writeAssistantMessage(
  handle: DbHandle,
  params: {
    conversationId: string;
    agentId: string;
    now: string;
    content: string;
    errorCode: string | null;
  },
): void {
  handle.db
    .insert(messages)
    .values({
      id: `msg_${randomUUID()}`,
      conversationId: params.conversationId,
      agentId: params.agentId,
      userId: LOCAL_USER_ID,
      role: 'assistant',
      content: params.content || '（生成失败）',
      status: params.errorCode ? 'failed' : 'complete',
      clientMessageId: null,
      errorCode: params.errorCode,
      metadataJson: null,
      createdAt: params.now,
      updatedAt: params.now,
    })
    .run();
}

/**
 * 默认 LLM 工厂：每次调用时解析生效配置，失败归一为 LLM_REQUEST_FAILED。
 */
export function createDefaultLlmStreamFactory(handle: DbHandle): LlmStreamFactory {
  return ({ system, messages: prompt }) => {
    try {
      const settings = resolveEffectiveLlmSettings(handle);
      if (!settings.apiKey) {
        throw new LlmRequestFailedError('LLM API key is not configured');
      }
      const result = streamText({
        model: getChatModel({
          baseUrl: settings.baseUrl,
          model: settings.model,
          apiKey: settings.apiKey,
        }),
        system,
        messages: prompt,
      });
      return {
        text: result.text,
        toUimessageStream: () => result.toUIMessageStream(),
      };
    } catch (error) {
      if (error instanceof LlmRequestFailedError) {
        throw error;
      }
      throw new LlmRequestFailedError(error instanceof Error ? error.message : undefined);
    }
  };
}

/**
 * 聊天编排：
 * 用户消息 → 独立情绪抽取（方案 1）→ 状态事件落库 → Prompt 组装（含更新后情绪）→ LLM 流式。
 * 情绪事件先于回复产生，createChatResponse 在流开头补发。
 */
export async function runChatPipeline(
  handle: DbHandle,
  body: ChatRequestBody,
  now: string,
  llmFactory?: LlmStreamFactory,
  extractComplete?: CompleteFn,
  emotionExtractor?: EmotionExtractor,
  memory?: MemoryClient | null,
  /** 重新生成场景：复用已入库的 user 消息（跳过持久化/情绪抽取/事实抽取/摘要触发）。 */
  existing?: { userMessageId: string; agentId: string },
): Promise<ChatPipelineResult> {
  const persisted = existing
    ? { messageId: existing.userMessageId, conversationId: body.conversationId, agentId: existing.agentId }
    : persistUserMessage(handle, body, now);
  const memoryClient = memory === undefined ? getDefaultMemoryRetriever().client() : memory;
  const recent = loadRecentWindow(handle, persisted.conversationId, 30);

  // 方案 1：聊天前独立抽取情绪 → 落库状态事件（失败降级不产生事件）
  // 重新生成复用已有 user 消息：情绪已随原消息抽取过，不再重复
  let stateEvent: ChatStateEventData | null = null;
  if (isEmotionEngineEnabled() && !existing) {
    try {
      const extractor = emotionExtractor ?? getDefaultEmotionExtractor(handle);
      const raw = await extractor(body.message, recent);
      if (raw) {
        const extraction = buildExtraction(raw.tag as EmotionTag, raw.intensity, raw.reason);
        stateEvent = applyStateEvent(handle, {
          agentId: persisted.agentId,
          conversationId: persisted.conversationId,
          triggerMessageId: persisted.messageId,
          extraction,
          now,
        });
      }
    } catch {
      // 抽取失败降级：不阻断聊天
    }
  }

  // S3b：fire-and-forget 事实抽取（写入层），失败不影响聊天流
  // 受控人格演化 P3：风格调整意图的消息不进事实抽取，
  // 避免"既生成提案参数、又沉淀偏好记忆"的双轨生效（F25/F26 边界）
  const isStyleAdjustment = looksLikeStyleAdjustment(body.message);
  const memoryExtraction = existing
    ? Promise.resolve(0) // 重新生成不重复抽取事实
    : isStyleAdjustment
    ? Promise.resolve(0)
    : scheduleFactExtraction(
    handle,
    {
      owner: { userId: LOCAL_USER_ID, agentId: persisted.agentId },
      sourceMessageId: persisted.messageId,
      userText: body.message,
      pad: stateEvent
        ? {
            v: stateEvent.after.valence,
            a: stateEvent.after.arousal,
            d: stateEvent.after.dominance,
          }
        : null,
      now,
    },
    extractComplete,
  );

  // Prompt 注入当前情绪（含本轮抽取后的展示态）——事实收集，文本块由插件生成
  const agentRow = handle.db.select().from(agents).where(eq(agents.id, persisted.agentId)).get();
  const emotionFacts = agentRow
    ? {
        display: computeDisplayState(agentRow, now),
        tag: agentRow.currentTag as EmotionTag,
      }
    : null;
  // S3c：检索 Top-K active 记忆注入 system（语义 + 情感一致性 + 时间），F18 删除即失效
  const memoryHits = searchMemories(handle, {
    owner: { userId: LOCAL_USER_ID, agentId: persisted.agentId },
    queryText: body.message,
    currentPad: stateEvent
      ? {
          v: stateEvent.after.valence,
          a: stateEvent.after.arousal,
          d: stateEvent.after.dominance,
        }
      : null,
    nowIso: now,
  });
  // 语义检索（bge-base-zh retriever 插件）补充召回历史对话；失败降级不影响对话
  let semanticHits: string[] = [];
  if (memoryClient) {
    try {
      const { topK } = loadMemoryConfig();
      semanticHits = await memoryClient.search(body.message, topK);
    } catch {
      // 降级约定:检索失败不阻断对话
    }
  }

  // 上下文插件挂载点：情绪行 / 长期记忆 / 语义记忆 / 会话摘要均为内置插件，
  // 第三方 contributor 按 order 追加；单个失败降级跳过，不阻断聊天。
  const contributions = await runContextContributors({
    handle,
    agentId: persisted.agentId,
    conversationId: persisted.conversationId,
    userText: body.message,
    now,
    emotion: emotionFacts,
    memoryHits,
    semanticHits,
  });

  // P1: 注入用户确认的表达风格配置（persona_versions active 版本；读取失败降级为仅锚点）。
  // 人格内核（锚点 + 风格）不开放插件化——这是安全边界。
  const activePersona = getActivePersona(handle, persisted.agentId);
  const systemParts = [PERSONA_CORE_MD];
  if (activePersona) {
    systemParts.push(renderPersonaStyleSection(activePersona.evolvable, activePersona.version));
  }
  systemParts.push(...contributions);
  const prompt = {
    system: systemParts.filter((part) => part.length > 0).join('\n\n'),
    messages: recent,
  };

  // 再巩固入口：命中即刷新 last_accessed_at（S4 formalize；随抽取 promise 一起被测试等待）
  const memoryAccess = Promise.resolve().then(() => {
    if (existing) return undefined; // 重新生成不改变记忆命中统计与摘要触发
    updateLastAccessed(handle, memoryHits.map((m) => m.id), now);
    reconsolidateHits(handle, memoryHits.map((m) => m.id), now);
    const summary = maybeTriggerSummary(handle, persisted.conversationId, persisted.agentId, now);
    if (summary.triggered && extractComplete) {
      return runSummaryTask(handle, summary.summaryId!, extractComplete, new Date().toISOString());
    }
    return undefined;
  });
  void memoryExtraction.then(() => memoryAccess).catch(() => undefined);

  // F36 调试模式：仅在 app_settings.debug_mode 开启时写入 Prompt 快照
  if (isDebugModeEnabled(handle)) {
    try {
      handle.db.insert(promptSnapshots).values({
        id: `snap_${randomUUID()}`,
        agentId: persisted.agentId,
        conversationId: persisted.conversationId,
        userMessageId: persisted.messageId,
        systemText: prompt.system,
        memoryIdsJson: JSON.stringify(memoryHits.map((m) => m.id)),
        recentWindowCount: String(prompt.messages.length),
        personaVersion: activePersona?.version ?? null,
        createdAt: now,
      }).run();
    } catch (error) {
      console.warn('[debug] prompt snapshot failed:', error);
    }
  }

  let llm: LlmStreamHandle;
  try {
    const factory = llmFactory ?? createDefaultLlmStreamFactory(handle);
    llm = factory(prompt);
  } catch (error) {
    writeAssistantMessage(handle, {
      conversationId: persisted.conversationId,
      agentId: persisted.agentId,
      now: new Date().toISOString(),
      content: '',
      errorCode: 'LLM_REQUEST_FAILED',
    });
    throw error instanceof LlmRequestFailedError
      ? error
      : new LlmRequestFailedError();
  }

  return {
    agentId: persisted.agentId,
    conversationId: persisted.conversationId,
    userMessageId: persisted.messageId,
    userMessage: body.message,
    memory: memoryClient,
    llm,
    stateEvent,
    memoryExtraction,
  };
}

/** UI 流组装：文本增量直通转发，流开头补发状态事件（已落库）。 */
export function createChatResponse(
  handle: DbHandle,
  pipeline: ChatPipelineResult,
  now: string,
): Response {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      // 流开头补发状态事件（事件已在 runChatPipeline 落库）
      if (pipeline.stateEvent) {
        const e = pipeline.stateEvent;
        writer.write({
          type: 'data-agent-state-event',
          data: { event: {
            id: e.id,
            agentId: pipeline.agentId,
            conversationId: pipeline.conversationId,
            triggerMessageId: e.triggerMessageId,
            source: 'user_message',
            ruleVersion: EMOTION_EXTRACTION_VERSION,
            before: e.before,
            delta: e.delta,
            after: e.after,
            discreteTag: e.discreteTag,
            reason: e.reason,
            evidenceText: e.evidenceText,
            confidence: e.confidence,
            createdAt: now,
          } },
          id: e.id,
        });
      }

      try {
        for await (const chunk of iterateLlmChunks(pipeline.llm.toUimessageStream())) {
          writer.write(chunk);
        }

        // text 承诺是权威全文;中途失败(拒绝)时走 failed 分支
        const content = await pipeline.llm.text;

        writeAssistantMessage(handle, {
          conversationId: pipeline.conversationId,
          agentId: pipeline.agentId,
          now: new Date().toISOString(),
          content,
          errorCode: null,
        });

        // T7:本轮对话(用户+助手)写入长期记忆;失败不影响响应流。
        if (pipeline.memory) {
          try {
            await pipeline.memory.indexDialogue([
              { role: 'user', content: pipeline.userMessage },
              { role: 'assistant', content },
            ]);
          } catch (error) {
            console.warn('[memory] index failed (degraded):', error instanceof Error ? error.message : error);
          }
        }
      } catch {
        writeAssistantMessage(handle, {
          conversationId: pipeline.conversationId,
          agentId: pipeline.agentId,
          now: new Date().toISOString(),
          content: '',
          errorCode: 'LLM_REQUEST_FAILED',
        });
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}

async function* iterateLlmChunks(
  stream: ReadableStream<UIMessageChunk> | AsyncIterable<UIMessageChunk>,
): AsyncGenerator<UIMessageChunk> {
  if (Symbol.asyncIterator in stream) {
    yield* stream as AsyncIterable<UIMessageChunk>;
    return;
  }
  const reader = (stream as ReadableStream<UIMessageChunk>).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    yield value;
  }
}

/** 聊天编排入口：route 只负责校验与错误映射。 */
export class RegenerateNotApplicableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'RegenerateNotApplicableError';
  }
}

/**
 * 重新生成最后一条 assistant 回复（含失败占位重试）：
 * - 最后一条消息必须是 assistant（streaming 中不可操作；主动消息不可重新生成）；
 * - 不物理删除（conversation_summaries 对消息有 RESTRICT 外键），
 *   而是标记为 failed / SUPERSEDED，前端按该 errorCode 过滤展示；
 * - 复用最后一条 user 消息走完整 prompt 组装（existing 路径：
 *   不重复持久化、不重复情绪抽取、不重复事实抽取、不触发摘要）；
 * - LLM 失败时写入新的 failed 占位（与普通聊天行为一致）。
 */
export async function runRegeneratePipeline(
  handle: DbHandle,
  params: { conversationId: string; agentId?: string },
  now: string,
  llmFactory?: LlmStreamFactory,
  memory?: MemoryClient | null,
): Promise<ChatPipelineResult> {
  const conversation = handle.db
    .select()
    .from(conversations)
    .where(eq(conversations.id, params.conversationId))
    .get();
  if (!conversation) {
    throw new ChatConversationNotFoundError(params.conversationId);
  }

  const last = handle.db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversation.id))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .get();
  if (!last || last.role !== 'assistant' || last.status === 'streaming') {
    throw new RegenerateNotApplicableError(
      '只有最后一条 assistant 回复可以重新生成',
    );
  }
  let metadata: { proactive?: boolean } | null = null;
  if (last.metadataJson) {
    try {
      metadata = JSON.parse(last.metadataJson) as { proactive?: boolean };
    } catch {
      metadata = null;
    }
  }
  if (metadata?.proactive === true) {
    throw new RegenerateNotApplicableError('主动消息不能重新生成');
  }

  const lastUser = handle.db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversation.id), eq(messages.role, 'user')))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .get();
  if (!lastUser || !lastUser.content.trim()) {
    throw new RegenerateNotApplicableError('没有可基于的用户消息');
  }

  handle.sqlite.transaction(() => {
    handle.db
      .update(messages)
      .set({
        status: 'failed',
        errorCode: 'SUPERSEDED',
        content: '（已重新生成）',
        updatedAt: now,
      })
      .where(eq(messages.id, last.id))
      .run();
  })();

  return runChatPipeline(
    handle,
    {
      agentId: conversation.agentId,
      conversationId: conversation.id,
      message: lastUser.content,
      clientMessageId: lastUser.clientMessageId ?? `regen_${lastUser.id}`,
    },
    now,
    llmFactory,
    undefined,
    undefined,
    memory,
    { userMessageId: lastUser.id, agentId: conversation.agentId },
  );
}

/** POST /api/conversations/:id/regenerate 请求入口：编排 → UIMessage 流。 */
export async function handleRegenerateRequest(
  deps: {
    conversationId: string;
    llmFactory?: LlmStreamFactory;
    memoryClient?: MemoryClient | null;
  },
  handle: DbHandle,
  now: string,
): Promise<Response> {
  const pipeline = await runRegeneratePipeline(
    handle,
    { conversationId: deps.conversationId },
    now,
    deps.llmFactory,
    deps.memoryClient,
  );
  return createChatResponse(handle, pipeline, now);
}
export async function handleChatRequest(
  deps: {
    body: ChatRequestBody;
    llmFactory?: LlmStreamFactory;
    extractComplete?: CompleteFn;
    emotionExtractor?: EmotionExtractor;
    memoryClient?: MemoryClient | null;
  },
  handle: DbHandle,
  now: string,
): Promise<Response> {
  const pipeline = await runChatPipeline(
    handle, deps.body, now, deps.llmFactory, deps.extractComplete, deps.emotionExtractor, deps.memoryClient,
  );
  return createChatResponse(handle, pipeline, now);
}

