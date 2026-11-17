import type { ProactiveStrategy } from '@aiko/shared';
import type { DbHandle } from '../db/client';
import {
  getRecallableMemories,
  getLatestNegativeStateEvent,
  getLastUserMessage,
  hasEmotionCareSince,
} from './repository';

export type StrategyPick = {
  strategy: ProactiveStrategy;
  evidence: string;
  /** 传给 LLM 的线索 */
  hint: string;
};

const NEGATIVE_VALENCE_THRESHOLD = -0.5;
const EMOTION_CARE_SETTLE_HOURS = 24;
const RECALL_MIN_AGE_DAYS = 7;
/** 情绪关怀的再关怀冷却：同一低落事件只跟进一次（用审计表时间近似） */
const EMOTION_CARE_COOLDOWN_DAYS = 7;

/**
 * 内容策略选择器（P4）：按优先级依次尝试，全部不满足返回 null（宁可不发）。
 * ① 情绪关怀——上次对话显著负面且已沉淀 ≥24h、近期未跟进；
 * ② 记忆回想——较早且近期未被访问的 active 记忆；
 * ③ 好奇提问——兜底，基于用户最近一条消息的话题。
 */
export function pickStrategy(
  handle: DbHandle,
  agentId: string,
  conversationId: string,
  nowMs: number,
): StrategyPick | null {
  // ① 情绪关怀
  const negative = getLatestNegativeStateEvent(
    handle,
    agentId,
    NEGATIVE_VALENCE_THRESHOLD,
    EMOTION_CARE_SETTLE_HOURS * 3600000,
    nowMs,
  );
  if (negative) {
    const cared = hasEmotionCareSince(
      handle,
      agentId,
      EMOTION_CARE_COOLDOWN_DAYS * 24 * 3600000,
      nowMs,
    );
    if (!cared) {
      return {
        strategy: 'emotion_care',
        evidence: '上次对话 valence ' + negative.valence.toFixed(2) + ' @ ' + negative.createdAt,
        hint: buildEmotionCareEvidence(negative.createdAt),
      };
    }
  }

  // ② 记忆回想
  const memories = getRecallableMemories(
    handle,
    agentId,
    RECALL_MIN_AGE_DAYS * 24 * 3600000,
    nowMs,
  );
  if (memories.length > 0) {
    const pick = memories[Math.floor(Math.random() * memories.length)]!;
    return {
      strategy: 'memory_recall',
      evidence: '记忆 ' + pick.id + '（' + pick.content.slice(0, 30) + '…）',
      hint: pick.content,
    };
  }

  // ③ 好奇提问（兜底）
  const lastUser = getLastUserMessage(handle, conversationId);
  if (lastUser) {
    const topic = lastUser.slice(0, 60);
    return {
      strategy: 'curious_question',
      evidence: '最近话题：' + topic,
      hint: topic,
    };
  }

  return null;
}

function buildEmotionCareEvidence(eventCreatedAt: string): string {
  return '情绪低落事件发生于 ' + eventCreatedAt + '，已沉淀超过 24 小时且未跟进';
}

// 注意：buildEmotionCarePrompt / buildMemoryRecallPrompt / buildCuriousPrompt 在 prompts.ts，
// 这里只负责选题与证据。
