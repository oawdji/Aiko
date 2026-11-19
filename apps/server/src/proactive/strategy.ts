import type { ProactiveStrategy } from '@aiko/shared';
import type { DbHandle } from '../db/client';
import {
  getRecallableMemories,
  getLatestNegativeStateEvent,
  getLastUserMessage,
  hasEmotionCareSince,
} from './repository';
import { createRegistry, type PluginDescriptor } from '../plugins/registry';
import { getDisabledPluginIds } from '../plugins/persistence';

export type StrategyPick = {
  strategy: ProactiveStrategy;
  evidence: string;
  /** 传给 LLM 的线索 */
  hint: string;
};

export type ProactiveStrategyContext = {
  handle: DbHandle;
  agentId: string;
  conversationId: string;
  nowMs: number;
};

/**
 * 主动消息策略插件挂载点（Phase 1）：
 * 内置三条策略（情绪关怀 → 记忆回想 → 好奇提问）以插件身份注册，
 * pickStrategy 按 priority 升序依次尝试，全部不满足返回 null（宁可不发）。
 * 第三方插件可注册自己的策略（如节日问候、久坐提醒），复用 policy 层的
 * 频率/免打扰治理——policy 是内核，不开放插件化。
 */
export type ProactiveStrategyPlugin = PluginDescriptor & {
  /** 升序，越小越优先 */
  priority: number;
  pick(ctx: ProactiveStrategyContext): StrategyPick | null;
};

const NEGATIVE_VALENCE_THRESHOLD = -0.5;
const EMOTION_CARE_SETTLE_HOURS = 24;
const RECALL_MIN_AGE_DAYS = 7;
/** 情绪关怀的再关怀冷却：同一低落事件只跟进一次（用审计表时间近似） */
const EMOTION_CARE_COOLDOWN_DAYS = 7;

function buildEmotionCareEvidence(eventCreatedAt: string): string {
  return '情绪低落事件发生于 ' + eventCreatedAt + '，已沉淀超过 24 小时且未跟进';
}

export const proactiveStrategyRegistry = createRegistry<ProactiveStrategyPlugin>();

proactiveStrategyRegistry.register({
  id: 'emotion_care',
  description: '上次对话显著负面（valence ≤ -0.5）且已沉淀 ≥24h、近期未跟进',
  priority: 1,
  pick({ handle, agentId, nowMs }) {
    const negative = getLatestNegativeStateEvent(
      handle,
      agentId,
      NEGATIVE_VALENCE_THRESHOLD,
      EMOTION_CARE_SETTLE_HOURS * 3600000,
      nowMs,
    );
    if (!negative) return null;
    const cared = hasEmotionCareSince(
      handle,
      agentId,
      EMOTION_CARE_COOLDOWN_DAYS * 24 * 3600000,
      nowMs,
    );
    if (cared) return null;
    return {
      strategy: 'emotion_care',
      evidence: '上次对话 valence ' + negative.valence.toFixed(2) + ' @ ' + negative.createdAt,
      hint: buildEmotionCareEvidence(negative.createdAt),
    };
  },
});

proactiveStrategyRegistry.register({
  id: 'memory_recall',
  description: '较早（≥7 天）且近期未被访问的 active 记忆回想',
  priority: 2,
  pick({ handle, agentId, nowMs }) {
    const memories = getRecallableMemories(
      handle,
      agentId,
      RECALL_MIN_AGE_DAYS * 24 * 3600000,
      nowMs,
    );
    if (memories.length === 0) return null;
    const pick = memories[Math.floor(Math.random() * memories.length)]!;
    return {
      strategy: 'memory_recall',
      evidence: '记忆 ' + pick.id + '（' + pick.content.slice(0, 30) + '…）',
      hint: pick.content,
    };
  },
});

proactiveStrategyRegistry.register({
  id: 'curious_question',
  description: '兜底：基于用户最近一条消息的话题好奇提问',
  priority: 3,
  pick({ handle, conversationId }) {
    const lastUser = getLastUserMessage(handle, conversationId);
    if (!lastUser) return null;
    const topic = lastUser.slice(0, 60);
    return {
      strategy: 'curious_question',
      evidence: '最近话题：' + topic,
      hint: topic,
    };
  },
});

/**
 * 内容策略选择器（P4）：按 priority 升序依次尝试（同 priority 按 id 稳定），
 * 全部不满足返回 null（宁可不发）。
 */
export function pickStrategy(
  handle: DbHandle,
  agentId: string,
  conversationId: string,
  nowMs: number,
): StrategyPick | null {
  const disabled = new Set(getDisabledPluginIds(handle));
  const sorted = [...proactiveStrategyRegistry.all()]
    .filter((p) => !disabled.has(p.id))
    .sort(
      (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
    );
  for (const strategy of sorted) {
    const pick = strategy.pick({ handle, agentId, conversationId, nowMs });
    if (pick) return pick;
  }
  return null;
}

// 注意：buildEmotionCarePrompt / buildMemoryRecallPrompt / buildCuriousPrompt 在 prompts.ts，
// 这里只负责选题与证据。