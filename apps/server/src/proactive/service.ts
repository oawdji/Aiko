import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { LOCAL_USER_ID, type ProactiveEvaluateResponse } from '@aiko/shared';
import { PERSONA_CORE_MD } from '../db/generated/persona-core';
import { conversations, messages } from '../db/schema';
import type { DbHandle } from '../db/client';
import { getActivePersona } from '../persona/repository';
import { renderPersonaStyleSection } from '../persona/render';
import {
  createDefaultPersonaComplete,
  type PersonaCompleteFn,
} from '../persona/llm';
import { loadProactiveConfig } from './config';
import {
  PROACTIVE_INSTRUCTIONS,
  buildCuriousPrompt,
  buildEmotionCarePrompt,
  buildMemoryRecallPrompt,
} from './prompts';
import { shouldProactive } from './policy';
import { pickStrategy } from './strategy';
import {
  countProactive24h,
  getLastProactiveAtMs,
  getLastUserMessageAtMs,
  insertProactiveAudit,
  listProactiveHistory as listProactiveHistoryRows,
} from './repository';

export class ProactiveConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`Conversation "${conversationId}" not found for this agent`);
    this.name = 'ProactiveConversationNotFoundError';
  }
}

export type ProactiveEvaluateInput = {
  agentId: string;
  conversationId: string;
  localMinutesOfDay: number;
  /** 评估时刻 ISO（服务端生成） */
  now: string;
};

/** 内容长度上限：主动消息必须简短。 */
const MAX_CONTENT_LEN = 300;

/**
 * 主动消息评估（Phase 4 核心，无状态单次决策）：
 * policy 时机守门 → 内容策略选题（情绪关怀/记忆回想/好奇提问）→ 人格装配 LLM 生成
 * → messages(assistant, metadata 标记) + proactive_messages 审计，单事务。
 * 任何拒绝/失败路径都只返回 send:false，不落库、不补发。
 */
export async function evaluateProactive(
  handle: DbHandle,
  input: ProactiveEvaluateInput,
  complete: PersonaCompleteFn = createDefaultPersonaComplete(handle),
): Promise<ProactiveEvaluateResponse> {
  const config = loadProactiveConfig(handle);
  const nowMs = Date.parse(input.now);

  const conversation = handle.db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.agentId, input.agentId),
      ),
    )
    .get();
  if (!conversation) {
    throw new ProactiveConversationNotFoundError(input.conversationId);
  }

  const since24h = new Date(nowMs - 24 * 3600000).toISOString();
  const policy = shouldProactive({
    config,
    nowMs,
    localMinutesOfDay: input.localMinutesOfDay,
    lastUserMessageAtMs: getLastUserMessageAtMs(handle, input.conversationId),
    lastProactiveAtMs: getLastProactiveAtMs(handle, input.agentId),
    proactiveCount24h: countProactive24h(handle, input.agentId, since24h),
  });
  if (!policy.allow) {
    return { send: false, reason: policy.reason, message: null };
  }

  const pick = pickStrategy(handle, input.agentId, input.conversationId, nowMs);
  if (!pick) {
    return { send: false, reason: 'no_strategy', message: null };
  }

  // 人格装配：与正常聊天同一套锚点 + 风格段（读取失败降级为仅锚点）
  const active = getActivePersona(handle, input.agentId);
  const systemParts = [PERSONA_CORE_MD];
  if (active) {
    systemParts.push(renderPersonaStyleSection(active.evolvable, active.version));
  }
  systemParts.push(PROACTIVE_INSTRUCTIONS);

  const prompt =
    pick.strategy === 'emotion_care'
      ? buildEmotionCarePrompt(pick.hint)
      : pick.strategy === 'memory_recall'
        ? buildMemoryRecallPrompt(pick.hint)
        : buildCuriousPrompt(pick.hint);

  let content: string;
  try {
    const raw = await complete({ system: systemParts.join('\n\n'), prompt });
    content = raw.trim().slice(0, MAX_CONTENT_LEN);
  } catch (error) {
    console.warn('[proactive] generation failed (degraded):', error instanceof Error ? error.message : error);
    return { send: false, reason: 'generation_failed', message: null };
  }
  if (!content) {
    return { send: false, reason: 'generation_failed', message: null };
  }

  const messageId = `msg_${randomUUID()}`;
  handle.sqlite.transaction(() => {
    handle.db
      .insert(messages)
      .values({
        id: messageId,
        conversationId: input.conversationId,
        agentId: input.agentId,
        userId: LOCAL_USER_ID,
        role: 'assistant',
        content,
        status: 'complete',
        clientMessageId: null,
        errorCode: null,
        metadataJson: JSON.stringify({
          proactive: true,
          strategy: pick.strategy,
          evidence: pick.evidence,
        }),
        createdAt: input.now,
        updatedAt: input.now,
      })
      .run();
    insertProactiveAudit(handle, {
      id: `pam_${randomUUID()}`,
      agentId: input.agentId,
      conversationId: input.conversationId,
      messageId,
      strategy: pick.strategy,
      reason: 'idle window reached, strategy: ' + pick.strategy,
      evidenceText: pick.evidence,
      createdAt: input.now,
    });
  })();

  return {
    send: true,
    reason: null,
    message: {
      id: messageId,
      conversationId: input.conversationId,
      content,
      strategy: pick.strategy,
      createdAt: input.now,
    },
  };
}

/** 主动消息历史（策略/证据/正文）。 */
export function listProactiveHistory(handle: DbHandle, agentId: string, limit = 50) {
  return listProactiveHistoryRows(handle, agentId, limit);
}
