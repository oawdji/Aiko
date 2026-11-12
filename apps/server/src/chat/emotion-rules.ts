import type { AgentEmotionState, EmotionTag } from '@aiko/shared';

/** 规则词典/阈值/分区变更时必须递增此版本（technical-design.md §10.3）。 */
export const EMOTION_RULES_VERSION = 'emotion-rules-v1';

/** 单条消息各维度 delta 上限（§10.5），超出截断。 */
export const EMOTION_DELTA_LIMIT = 0.3;

/** 离散标签分区阈值（§10.7），不做浮点容差，保证结果确定。 */
export const TAG_THRESHOLD = 0.05;

type Clue = {
  keyword: string;
  dValence: number;
  dArousal: number;
  confidence: number;
};

/** §10.3 规则词典（emotion-rules-v1）。 */
const CLUES: readonly Clue[] = [
  { keyword: '开心', dValence: 0.12, dArousal: 0.08, confidence: 0.7 },
  { keyword: '高兴', dValence: 0.12, dArousal: 0.08, confidence: 0.7 },
  { keyword: '喜欢', dValence: 0.08, dArousal: 0.0, confidence: 0.6 },
  { keyword: '有趣', dValence: 0.1, dArousal: 0.06, confidence: 0.6 },
  { keyword: '累', dValence: -0.1, dArousal: -0.04, confidence: 0.7 },
  { keyword: '难过', dValence: -0.14, dArousal: -0.06, confidence: 0.75 },
  { keyword: '烦', dValence: -0.1, dArousal: 0.06, confidence: 0.65 },
  { keyword: '焦虑', dValence: -0.08, dArousal: 0.12, confidence: 0.7 },
  { keyword: '激动', dValence: 0.04, dArousal: 0.14, confidence: 0.65 },
  { keyword: '紧张', dValence: -0.06, dArousal: 0.12, confidence: 0.7 },
  { keyword: '平静', dValence: 0.04, dArousal: -0.08, confidence: 0.6 },
];

const NEGATION_WORD = '不';

export type EmotionExtraction = {
  delta: AgentEmotionState;
  confidence: number;
  evidenceText: string;
  reason: string;
};

/**
 * 规则词典抽取（纯函数，§10.3–§10.6）：
 * - 命中线索累加 delta，confidence 取命中线索最大值；
 * - 关键词前 2 字符内出现「不」→ 跳过该线索并整体置信度 ×0.8（§10.4：宁可不更新，不更新错方向）；
 * - 无线索返回 null（MVP 不生成状态事件，避免噪声）。
 */
export function extractEmotion(text: string): EmotionExtraction | null {
  let dValence = 0;
  let dArousal = 0;
  let confidence = 0;
  let negatedCount = 0;
  const evidence: string[] = [];

  for (const clue of CLUES) {
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

  const after: AgentEmotionState = {
    valence: clampState(current.valence + dValence),
    arousal: clampState(current.arousal + dArousal),
  };

  return {
    after,
    delta: {
      valence: Number((after.valence - current.valence).toFixed(4)),
      arousal: Number((after.arousal - current.arousal).toFixed(4)),
    },
  };
}

/**
 * 离散标签分区映射（§10.7）：
 * 先 clamp 再按固定阈值 0.05 分区，纯函数，结果确定。
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
