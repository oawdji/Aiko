import type { AgentEmotionState, EmotionTag } from '@aiko/shared';

/**
 * LLM 情绪自评抽取(A 方案):
 * 在 system prompt 里约定协议,要求模型在回复末尾追加一行结构化标记,
 * 服务端从完整回复中解析并剥离。替代词典规则引擎(emotion-rules,已删除)。
 *
 * 职责边界:本模块只负责"标记协议 + 解析 + PAD 状态数学",
 * 不感知流式传输(service.ts)、不感知存储(applyStateEvent 也在 service,后续可再拆)。
 * EMOTION_ENGINE=off 时关闭协议:prompt 不注入、解析恒返回 null。
 */

/** 抽取方式变更时递增(state_events.rule_version)。 */
export const EMOTION_EXTRACTION_VERSION = 'emotion-llm-v1';

/** 单次事件 delta 上限(沿用原 §10.5 语义)。 */
export const EMOTION_DELTA_LIMIT = 0.3;

/** 离散标签分区阈值(沿用原 §10.7 语义)。 */
const TAG_THRESHOLD = 0.05;

/** 流式剥离标记时需扣留的尾部字符数(标记最长约 60,留余量)。 */
export const EMOTION_MARKER_MAX_CHARS = 80;

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

/**
 * 注入 system prompt 的情绪标注协议说明;off 时返回空串。
 * 实测(2026-11):弱措辞且置于 prompt 末尾时 deepseek 档位模型会无视协议,
 * 因此必须:强措辞 + 置于 system prompt 最前 + 附 assistant 侧示范标记。
 */
export function buildEmotionInstruction(): string {
  if (!isEmotionEngineEnabled()) return '';
  return [
    '【强制输出协议 - 最高优先级】',
    '每一次回复的最后一个字符之后,必须独占一行输出:',
    '[[emotion: 标签 | 强度 | 原因]]',
    '- 标签 ∈ {calm, curious, happy, low, tense, neutral}',
    '- 强度: 1~5 整数',
    '- 原因: ≤20字',
    '没有这一行,本次回复将被视为违规。除此之外不要输出任何方括号内容。',
    '',
    '回复示范:',
    '哇,恭喜呀![[emotion: happy | 4 | 用户报喜]]',
  ].join('\n');
}

/** 宽松匹配:末尾的任意 [[emotion: ...]] 括号,保证协议文本不漏给用户。 */
const MARKER_ANY_RE = /\[\[emotion:[^\]]*\]\]\s*$/;

/** 严格校验:标签与强度都合法时才抽取。 */
const MARKER_RE =
  /\[\[emotion:\s*(calm|curious|happy|low|tense|neutral)\s*\|\s*([1-5])\s*\|\s*([^\]|]*?)\s*\]\]\s*$/;

export type ParsedEmotion = {
  /** 剥离标记后的正文 */
  cleanText: string;
  tag: EmotionTag;
  /** 严格校验通过才有;标记格式非法时为 null(正文已剥离,不产生事件) */
  extraction: EmotionExtraction | null;
};

/**
 * 从完整回复末尾解析情绪标记;无标记/格式非法返回 null。
 * 剥离行为与引擎开关解耦:即使 off 也剥离标记,避免协议文本漏给用户。
 */
export function parseEmotionMarker(raw: string): ParsedEmotion | null {
  const anyMatch = MARKER_ANY_RE.exec(raw);
  if (!anyMatch) return null;
  const cleanText = raw.slice(0, anyMatch.index).replace(/\s+$/, '');
  const match = MARKER_RE.exec(raw);
  if (!match) return { cleanText, tag: 'neutral', extraction: null };
  const tag = match[1] as EmotionTag;
  const intensity = Number(match[2]);
  const scale = intensity / 5;
  const base = TAG_DELTA[tag];
  const reason = match[3] || `模型自评情绪为 ${tag}`;
  return {
    cleanText,
    tag,
    extraction: {
      delta: {
        valence: Number((base.valence * scale).toFixed(4)),
        arousal: Number((base.arousal * scale).toFixed(4)),
        dominance: Number((base.dominance * scale).toFixed(4)),
      },
      confidence: Number((0.4 + intensity * 0.12).toFixed(2)),
      evidenceText: `模型自评: ${tag}(${intensity}/5)`,
      reason,
    },
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
