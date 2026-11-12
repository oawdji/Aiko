import type { AgentEmotionState, EmotionTag } from '@aiko/shared';
import { EMOTION_CLUES } from './emotion-lexicon';

/** 规则词典/阈值/分区变更时必须递增此版本（technical-design.md §10.3）。 */
export const EMOTION_RULES_VERSION = 'emotion-rules-v2';

/** 单条消息各维度 delta 上限（§10.5），超出截断。 */
export const EMOTION_DELTA_LIMIT = 0.3;

/** 离散标签分区阈值（§10.7），不做浮点容差，保证结果确定。 */
export const TAG_THRESHOLD = 0.05;

const NEGATION_WORD = '不';

export type EmotionExtraction = {
  delta: AgentEmotionState;
  confidence: number;
  evidenceText: string;
  reason: string;
};

/**
 * 规则词典抽取（纯函数，§10.3–§10.6）：
 * - 命中线索累加三维 delta，confidence 取命中线索最大值；
 * - 关键词前 2 字符内出现「不」→ 跳过该线索并整体置信度 ×0.8（§10.4：宁可不更新，不更新错方向）；
 * - 无线索返回 null（不生成状态事件，避免噪声）。
 */
export function extractEmotion(text: string): EmotionExtraction | null {
  let dValence = 0;
  let dArousal = 0;
  let dDominance = 0;
  let confidence = 0;
  let negatedCount = 0;
  const evidence: string[] = [];

  for (const clue of EMOTION_CLUES) {
    let searchFrom = 0;
    while (true) {
      const index = text.indexOf(clue.keyword, searchFrom);
      if (index === -1) break;
      searchFrom = index + clue.keyword.length;

      const prefix = text.slice(Math.max(0, index - 2), index);
      if (prefix.includes(NEGATION_WORD)) {
        negatedCount += 1;
        continue;
      }

      dValence += clue.dValence;
      dArousal += clue.dArousal;
      dDominance += clue.dDominance;
      confidence = Math.max(confidence, clue.confidence);
      if (!evidence.includes(clue.keyword)) evidence.push(clue.keyword);
    }
  }

  if (evidence.length === 0) return null;

  const finalConfidence = negatedCount > 0 ? confidence * 0.8 : confidence;
  const evidenceText = evidence.join('、');

  return {
    delta: {
      valence: Number(dValence.toFixed(4)),
      arousal: Number(dArousal.toFixed(4)),
      dominance: Number(dDominance.toFixed(4)),
    },
    confidence: Number(finalConfidence.toFixed(2)),
    evidenceText,
    reason: `你提到「${evidenceText}」，情绪有所波动。`,
  };
}

export function clampState(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

/**
 * 单条消息 delta 截断 + 状态更新公式（§10.5）。
 * 返回 after 与实际生效的 delta（截断后的值），供 state_events 落库。
 */
export function applyEmotion(
  current: AgentEmotionState,
  extraction: EmotionExtraction,
): { after: AgentEmotionState; delta: AgentEmotionState } {
  const dValence = Math.min(
    EMOTION_DELTA_LIMIT,
    Math.max(-EMOTION_DELTA_LIMIT, extraction.delta.valence),
  );
  const dArousal = Math.min(
    EMOTION_DELTA_LIMIT,
    Math.max(-EMOTION_DELTA_LIMIT, extraction.delta.arousal),
  );
  const dDominance = Math.min(
    EMOTION_DELTA_LIMIT,
    Math.max(-EMOTION_DELTA_LIMIT, extraction.delta.dominance),
  );

  const after: AgentEmotionState = {
    valence: clampState(current.valence + dValence),
    arousal: clampState(current.arousal + dArousal),
    dominance: clampState(current.dominance + dDominance),
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

/**
 * 离散标签分区映射（§10.7）：
 * 先 clamp 再按固定阈值 0.05 分区，纯函数，结果确定。
 * dominance 不参与分区，仅用于展示与 prompt 注入。
 */
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
