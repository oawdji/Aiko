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
import { agents, conversations, messages, stateEvents } from '../db/schema';
import { type PromptMessage } from './recent-window';
import { EMOTION_RULES_VERSION, applyEmotion, computeTag, type EmotionExtraction } from './emotion-rules';
import {
  createEmotionEngine,
  resolveDefaultEmotionEngineId,
  type EmotionEngine,
} from './emotion-engine';
import { computeDisplayState, resolveDecayConfig, revertToBaseline } from './emotion-decay';
import { buildEmotionPromptLine } from './emotion-prompt';
import { createDefaultExtractComplete, scheduleFactExtraction } from '../extraction/pipeline';
import { searchMemories, updateLastAccessed } from '../memories/retrieval';
import { maybeTriggerSummary, reconsolidateHits, runSummaryTask } from '../memories/lifecycle';
import { isDebugModeEnabled } from '../settings/service';
import { promptSnapshots } from '../db/schema';
import type { CompleteFn } from '../extraction/types';

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
  stateEvent: ChatStateEventData | null;
  /** fire-and-forget 的事实抽取 promise，route 不 await；仅测试用 */
  memoryExtraction?: Promise<number>;
  llm: LlmStreamHandle;
};

/** LLM 结果抽象：真实 streamText 与测试 fake 都满足此形状。 */
export type LlmStreamHandle = {
  text: PromiseLike<string>;
  toUimessageStream: () => ReadableStream<UIMessageChunk> | AsyncIterable<UIMessageChunk>;
};

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
    (error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
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

/** M3.3 接线：无线索返回 null（§10.6 不生成事件）；有线索落 state_event 并更新 agent 快照。 */
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

  // 先基线回归（OU，§10.11），再叠加 delta；回归折叠进本事件 before，不落 time_decay 事件
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
        ruleVersion: EMOTION_RULES_VERSION,
        beforeValence: before.valence,
        beforeArousal: before.arousal,
        deltaValence: delta.valence,
        deltaArousal: delta.arousal,
        afterValence: after.valence,
        afterArousal: after.arousal,
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

/** 数据库近期窗口（替代 Phase 0 的前端携带历史，见 recent-window.ts 注释）。 */
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
 * 默认 LLM 工厂：每次调用时解析生效配置（app_settings 覆盖 > 环境变量 > 默认值），
 * 失败（含未配置 Key）映射为契约错误。设置修改后热生效、无需重启。
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
      // 配置缺失等同步失败也归一为 LLM_REQUEST_FAILED
      throw new LlmRequestFailedError(error instanceof Error ? error.message : undefined);
    }
  };
}

/**
 * M3.4 编排（api-contract.md §13.5 流程 5–11）：
 * 用户消息 → 情绪抽取/事件 → Prompt 组装（PERSONA_CORE + 数据库近期窗口）→ LLM 流式。
 * assistant 落库发生在 UI stream 消费完成之后（createChatResponse 内）。
 */
export async function runChatPipeline(
  handle: DbHandle,
  body: ChatRequestBody,
  now: string,
  llmFactory?: LlmStreamFactory,
  emotionEngine?: EmotionEngine,
  extractComplete?: CompleteFn,
): Promise<ChatPipelineResult> {
  const persisted = persistUserMessage(handle, body, now);

  const engine =
    emotionEngine ??
    createEmotionEngine(
      resolveDefaultEmotionEngineId(),
      extractComplete ?? createDefaultExtractComplete(handle),
    );
  const extraction = await engine(body.message);
  const stateEvent = extraction
    ? applyStateEvent(handle, {
        agentId: persisted.agentId,
        conversationId: persisted.conversationId,
        triggerMessageId: persisted.messageId,
        extraction,
        now,
      })
    : null;

  // S3b：fire-and-forget 事实抽取（写入层），失败不影响聊天流
  const memoryExtraction = scheduleFactExtraction(
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

  // Prompt 注入当前情绪（读时回归后的展示态，§10.11）
  const agentRow = handle.db.select().from(agents).where(eq(agents.id, persisted.agentId)).get();
  const emotionLine = agentRow
    ? buildEmotionPromptLine(computeDisplayState(agentRow, now), agentRow.currentTag as EmotionTag)
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
  const memoryLine =
    memoryHits.length > 0
      ? '关于用户的长期记忆（自然地运用，不要逐条复述）：\n' +
        memoryHits.map((m) => '- ' + m.content).join('\n')
      : null;
  // 再巩固入口：命中即刷新 last_accessed_at（S4 formalize；随抽取 promise 一起被测试等待）
  const memoryAccess = Promise.resolve().then(() => {
    updateLastAccessed(handle, memoryHits.map((m) => m.id), now);
    reconsolidateHits(handle, memoryHits.map((m) => m.id), now);
    const summary = maybeTriggerSummary(handle, persisted.conversationId, persisted.agentId, now);
    if (summary.triggered && extractComplete) {
      return runSummaryTask(handle, summary.summaryId!, extractComplete, new Date().toISOString());
    }
    return undefined;
  });
  void memoryExtraction.then(() => memoryAccess).catch(() => undefined);

  const systemParts = [PERSONA_CORE_MD];
  if (emotionLine) systemParts.push(emotionLine);
  if (memoryLine) systemParts.push(memoryLine);
  const prompt = {
    system: systemParts.join('\n\n'),
    messages: loadRecentWindow(handle, persisted.conversationId, 30),
  };

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
    stateEvent,
    llm,
    memoryExtraction,
  };
}
/** UI 流组装：状态事件 data part 先于文本增量（Phase 0 锁定顺序），结束后 assistant 落库。 */
export function createChatResponse(
  handle: DbHandle,
  pipeline: ChatPipelineResult,
  now: string,
): Response {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      if (pipeline.stateEvent) {
        writer.write({
          type: 'data-agent-state-event',
          data: { event: {
            id: pipeline.stateEvent.id,
            agentId: pipeline.agentId,
            conversationId: pipeline.conversationId,
            triggerMessageId: pipeline.stateEvent.triggerMessageId,
            source: 'user_message',
            ruleVersion: EMOTION_RULES_VERSION,
            before: pipeline.stateEvent.before,
            delta: pipeline.stateEvent.delta,
            after: pipeline.stateEvent.after,
            discreteTag: pipeline.stateEvent.discreteTag,
            reason: pipeline.stateEvent.reason,
            evidenceText: pipeline.stateEvent.evidenceText,
            confidence: pipeline.stateEvent.confidence,
            createdAt: now,
          } },
          id: pipeline.stateEvent.id,
        });
      }

      writer.merge(pipeline.llm.toUimessageStream() as Parameters<typeof writer.merge>[0]);

      try {
        const content = await pipeline.llm.text;
        writeAssistantMessage(handle, {
          conversationId: pipeline.conversationId,
          agentId: pipeline.agentId,
          now: new Date().toISOString(),
          content,
          errorCode: null,
        });
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

/** 聊天编排入口：route 只负责校验与错误映射。 */
export async function handleChatRequest(
  deps: {
    body: ChatRequestBody;
    llmFactory?: LlmStreamFactory;
    emotionEngine?: EmotionEngine;
  },
  handle: DbHandle,
  now: string,
): Promise<Response> {
  const pipeline = await runChatPipeline(handle, deps.body, now, deps.llmFactory, deps.emotionEngine);
  return createChatResponse(handle, pipeline, now);
}

