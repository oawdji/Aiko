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
import {
  EMOTION_EXTRACTION_VERSION,
  EMOTION_MARKER_MAX_CHARS,
  applyEmotion,
  buildEmotionInstruction,
  computeTag,
  isEmotionEngineEnabled,
  parseEmotionMarker,
  type EmotionExtraction,
} from './emotion-llm';
import { computeDisplayState, resolveDecayConfig, revertToBaseline } from './emotion-decay';
import { buildEmotionPromptLine } from './emotion-prompt';
import { loadMemoryConfig } from '../config/memory';
import { createPythonMemoryClient, type MemoryClient } from './memory-client';

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
        ruleVersion: EMOTION_EXTRACTION_VERSION,
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
  memory?: MemoryClient | null,
): Promise<ChatPipelineResult> {
  const persisted = persistUserMessage(handle, body, now);
  // T7:记忆客户端注入。undefined = 默认 Python 子进程客户端;null = 显式禁用(测试)。
  const memoryClient = memory === undefined ? createPythonMemoryClient() : memory;

  // Prompt 注入当前情绪（读时回归后的展示态，§10.11）
  const agentRow = handle.db.select().from(agents).where(eq(agents.id, persisted.agentId)).get();
  const emotionLine = agentRow
    ? buildEmotionPromptLine(computeDisplayState(agentRow, now), agentRow.currentTag as EmotionTag)
    : null;
  let memoryBlock = "";
  if (memoryClient) {
    try {
      const { topK } = loadMemoryConfig();
      const hits = await memoryClient.search(body.message, topK);
      if (hits.length > 0) {
        memoryBlock = `[相关记忆]
${hits.map((h) => `- ${h}`).join("\n")}\n\n(以上为历史对话记忆,仅供参考,不要主动提及本列表)`;
      }
    } catch {
      // 降级约定:检索失败不阻断对话
    }
  }
  const systemBase = emotionLine ? `${PERSONA_CORE_MD}\n\n${emotionLine}` : PERSONA_CORE_MD;
  const prompt = {
    // 协议必须置于最前:置于末尾时模型会无视(见 emotion-llm.ts 注释)
    system: [buildEmotionInstruction(), systemBase, memoryBlock]
      .filter((part) => part.length > 0)
      .join('\n\n'),
    messages: loadRecentWindow(handle, persisted.conversationId, 30),
  };

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
  };
}
/** UI 流组装（A 方案）：文本增量流式转发（尾部扣留待剥离情绪标记），流结束后解析情绪、落库并补发状态事件（事件后置于文本）。 */
export function createChatResponse(
  handle: DbHandle,
  pipeline: ChatPipelineResult,
  now: string,
): Response {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      let emittedChars = 0;
      let tail = '';
      let lastTextId = 'aiko-tail';
      // text-end 必须随尾部扣留一起延后:短回复的全部 delta 都在缓冲里,
      // 若 end 先透传,补发的 delta 会落在已关闭的文本部分上(前端报 missing text part)。
      const pendingTextEnds: UIMessageChunk[] = [];
      try {
        for await (const chunk of iterateLlmChunks(pipeline.llm.toUimessageStream())) {
          if (chunk.type === 'text-delta') {
            lastTextId = chunk.id;
            tail += chunk.delta;
            // 扣留尾部，防止情绪标记漏进用户可见流
            if (tail.length > EMOTION_MARKER_MAX_CHARS) {
              const safe = tail.slice(0, -EMOTION_MARKER_MAX_CHARS);
              writer.write({ type: 'text-delta', id: chunk.id, delta: safe });
              emittedChars += safe.length;
              tail = tail.slice(-EMOTION_MARKER_MAX_CHARS);
            }
          } else if (chunk.type === 'text-end') {
            pendingTextEnds.push(chunk);
          } else {
            writer.write(chunk);
          }
        }

        const rawText = await pipeline.llm.text;
        const parsed = parseEmotionMarker(rawText);
        const content = parsed ? parsed.cleanText : rawText;
        const rest = content.slice(emittedChars);
        if (rest) {
          writer.write({ type: 'text-delta', id: lastTextId, delta: rest });
        }
        for (const end of pendingTextEnds) {
          writer.write(end);
        }

        writeAssistantMessage(handle, {
          conversationId: pipeline.conversationId,
          agentId: pipeline.agentId,
          now: new Date().toISOString(),
          content,
          errorCode: null,
        });

        if (parsed?.extraction && isEmotionEngineEnabled()) {
          const event = applyStateEvent(handle, {
            agentId: pipeline.agentId,
            conversationId: pipeline.conversationId,
            triggerMessageId: pipeline.userMessageId,
            extraction: parsed.extraction,
            now,
          });
          writer.write({
            type: 'data-agent-state-event',
            data: { event: {
              id: event.id,
              agentId: pipeline.agentId,
              conversationId: pipeline.conversationId,
              triggerMessageId: event.triggerMessageId,
              source: 'user_message',
              ruleVersion: EMOTION_EXTRACTION_VERSION,
              before: event.before,
              delta: event.delta,
              after: event.after,
              discreteTag: event.discreteTag,
              reason: event.reason,
              evidenceText: event.evidenceText,
              confidence: event.confidence,
              createdAt: now,
            } },
            id: event.id,
          });
        }

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
export async function handleChatRequest(
  deps: {
    body: ChatRequestBody;
    llmFactory?: LlmStreamFactory;
    memoryClient?: MemoryClient | null;
  },
  handle: DbHandle,
  now: string,
): Promise<Response> {
  const pipeline = await runChatPipeline(handle, deps.body, now, deps.llmFactory, deps.memoryClient);
  return createChatResponse(handle, pipeline, now);
}
