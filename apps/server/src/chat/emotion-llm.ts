import type { AgentEmotionState, EmotionTag } from '@aiko/shared';

/**
 * PAD 情绪状态数学模块：
 * applyEmotion（增量截断 + 状态更新）/ computeTag（离散标签分区）/ clampState。
 * 情绪抽取已改为聊天前独立 LLM 小调用（emotion-extract.ts），
 * 不再依赖回复内嵌标记协议。
 * EMOTION_ENGINE=off 时关闭：不调用抽取、不产生事件。
 */

/** 抽取方式变更时递增(state_events.rule_version)。 */
export const EMOTION_EXTRACTION_VERSION = 'emotion-llm-v2';

/** 单次事件 delta 上限(沿用原 §10.5 语义)。 */
export const EMOTION_DELTA_LIMIT = 0.3;

/** 离散标签分区阈值(沿用原 §10.7 语义)。 */
const TAG_THRESHOLD = 0.05;

export type EmotionExtraction = {
  delta: AgentEmotionState;
  confidence: number;
  evidenceText: string;
  reason: string;
};

/** 各标签在强度 5/5 时的基础 PAD 增量;实际按强度线性缩放。 */
const TAG_DELTA: Record<EmotionTag, AgentEmotionState> = {
  happy: { valence: 0.25, arousal: 0.2, dominance: 0.1 },
  calm: { valence: 0.1, arousal: -0.1, dominance: 0.05 },
  curious: { valence: 0.1, arousal: 0.15, dominance: 0.05 },
  neutral: { valence: 0, arousal: 0, dominance: 0 },
  low: { valence: -0.3, arousal: -0.15, dominance: -0.1 },
  tense: { valence: -0.2, arousal: 0.25, dominance: -0.1 },
};

export function isEmotionEngineEnabled(): boolean {
  return process.env.EMOTION_ENGINE !== 'off';
}

/** 将抽取结果（标签+强度）换算为 PAD 增量 EmotionExtraction。 */
export function buildExtraction(
  tag: EmotionTag,
  intensity: number,
  reason: string,
): EmotionExtraction {
  const scale = intensity / 5;
  const base = TAG_DELTA[tag];
  return {
    delta: {
      valence: Number((base.valence * scale).toFixed(4)),
      arousal: Number((base.arousal * scale).toFixed(4)),
      dominance: Number((base.dominance * scale).toFixed(4)),
    },
    confidence: Number((0.4 + intensity * 0.12).toFixed(2)),
    evidenceText: `模型自评: ${tag}(${intensity}/5)`,
    reason,
  };
}

export function clampState(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

/** 单条事件 delta 截断 + 状态更新;返回 after 与实际生效 delta。 */
export function applyEmotion(
  current: AgentEmotionState,
  extraction: EmotionExtraction,
): { after: AgentEmotionState; delta: AgentEmotionState } {
  const clampDelta = (v: number) =>
    Math.min(EMOTION_DELTA_LIMIT, Math.max(-EMOTION_DELTA_LIMIT, v));
  const after: AgentEmotionState = {
    valence: clampState(current.valence + clampDelta(extraction.delta.valence)),
    arousal: clampState(current.arousal + clampDelta(extraction.delta.arousal)),
    dominance: clampState(current.dominance + clampDelta(extraction.delta.dominance)),
  };
  return {
    after,
    delta: {
      valence: Number((after.valence - current.valence).toFixed(4)),
      arousal: Number((after.arousal - current.arousal).toFixed(4)),
      dominance: Number((after.dominance - current.dominance).toFixed(4)),
    },
  };
}

/** 离散标签分区:valence/arousal 按固定阈值 0.05 分区,结果确定。 */
export function computeTag(state: AgentEmotionState): EmotionTag {
  const valence = clampState(state.valence);
  const arousal = clampState(state.arousal);
  if (valence <= -TAG_THRESHOLD) {
    return arousal > TAG_THRESHOLD ? 'tense' : 'low';
  }
  if (valence >= TAG_THRESHOLD) {
    return arousal > TAG_THRESHOLD ? 'happy' : 'calm';
  }
  return arousal > TAG_THRESHOLD ? 'curious' : 'neutral';
}
