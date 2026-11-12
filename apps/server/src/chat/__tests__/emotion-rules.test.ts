import { describe, expect, it } from 'vitest';
import {
  EMOTION_RULES_VERSION,
  EMOTION_DELTA_LIMIT,
  TAG_THRESHOLD,
  applyEmotion,
  computeTag,
  extractEmotion,
} from '../emotion-rules';

describe('extractEmotion (M3.3)', () => {
  it('exposes the frozen rule version', () => {
    expect(EMOTION_RULES_VERSION).toBe('emotion-rules-v2');
  });

  it('returns null when no clue is found', () => {
    expect(extractEmotion('今天天气不错，我们聊聊工作吧')).toBeNull();
    expect(extractEmotion('')).toBeNull();
  });

  it('matches a single clue with dictionary values', () => {
    const result = extractEmotion('今天好累');
    expect(result).toEqual({
      delta: { valence: -0.1, arousal: -0.04, dominance: 0 },
      confidence: 0.7,
      evidenceText: '累',
      reason: expect.stringContaining('累'),
    });
  });

  it('sums multiple clues and keeps max confidence', () => {
    const result = extractEmotion('有点焦虑也有些开心');
    expect(result?.delta).toEqual({ valence: 0.04, arousal: 0.2, dominance: 0 });
    expect(result?.confidence).toBe(0.7);
    expect(result?.evidenceText).toBe('开心、焦虑');
  });

  it('skips negated clues and lowers confidence', () => {
    const result = extractEmotion('我不累，其实挺开心的');
    // 「不累」被跳过，只剩「开心」
    expect(result?.delta).toEqual({ valence: 0.12, arousal: 0.08, dominance: 0 });
    expect(result?.confidence).toBeCloseTo(0.7 * 0.8);
    expect(result?.evidenceText).toBe('开心');
  });

  it('extracts dominance-only cues (v2)', () => {
    const result = extractEmotion('都听我的');
    expect(result?.delta).toEqual({ valence: 0, arousal: 0.04, dominance: -0.06 });
    expect(result?.confidence).toBe(0.5);
  });

  it('sums repeated dominance cues', () => {
    const result = extractEmotion('听我的，听我的，帮帮我');
    expect(result?.delta.dominance).toBe(-0.16);
  });

  it('does not treat 不 far away as negation', () => {
    const result = extractEmotion('不想说话，但是今天好累');
    // 「不」距离「累」超过 2 字符，正常命中
    expect(result?.delta).toEqual({ valence: -0.1, arousal: -0.04, dominance: 0 });
    expect(result?.confidence).toBe(0.7);
  });
});

describe('applyEmotion (M3.3)', () => {
  it('applies delta and clamps to [-1, 1]', () => {
    const { after } = applyEmotion({ valence: 0.95, arousal: -0.9, dominance: 0 }, {
      delta: { valence: 0.2, arousal: -0.2, dominance: 0 },
      confidence: 0.7,
      evidenceText: '开心',
      reason: 'x',
    });
    expect(after).toEqual({ valence: 1, arousal: -1, dominance: 0 });
  });

  it('applies and truncates dominance delta', () => {
    const { after, delta } = applyEmotion(
      { valence: 0, arousal: 0, dominance: 0 },
      {
        delta: { valence: 0, arousal: 0, dominance: 0.36 },
        confidence: 0.5,
        evidenceText: 'x',
        reason: 'x',
      },
    );
    expect(delta.dominance).toBe(EMOTION_DELTA_LIMIT);
    expect(after.dominance).toBe(EMOTION_DELTA_LIMIT);
  });

  it('truncates per-message delta beyond ±0.3', () => {
    const extraction = {
      delta: { valence: -0.14 - 0.14 - 0.1, arousal: 0, dominance: 0 },
      confidence: 0.8,
      evidenceText: '难过、难过、烦',
      reason: 'x',
    };
    const { delta, after } = applyEmotion({ valence: 0, arousal: 0, dominance: 0 }, extraction);
    expect(delta.valence).toBe(-EMOTION_DELTA_LIMIT);
    expect(after.valence).toBe(-EMOTION_DELTA_LIMIT);
  });
});

describe('computeTag (M3.3)', () => {
  const t = TAG_THRESHOLD;

  it('maps the nine partition cells', () => {
    expect(computeTag({ valence: -0.5, arousal: -0.5, dominance: 0 })).toBe('low');
    expect(computeTag({ valence: -0.5, arousal: 0, dominance: 0 })).toBe('low');
    expect(computeTag({ valence: -0.5, arousal: 0.5, dominance: 0 })).toBe('tense');
    expect(computeTag({ valence: 0, arousal: -0.5, dominance: 0 })).toBe('neutral');
    expect(computeTag({ valence: 0, arousal: 0, dominance: 0 })).toBe('neutral');
    expect(computeTag({ valence: 0, arousal: 0.5, dominance: 0 })).toBe('curious');
    expect(computeTag({ valence: 0.5, arousal: -0.5, dominance: 0 })).toBe('calm');
    expect(computeTag({ valence: 0.5, arousal: 0, dominance: 0 })).toBe('calm');
    expect(computeTag({ valence: 0.5, arousal: 0.5, dominance: 0 })).toBe('happy');
  });

  it('treats exactly ±0.05 as the boundary (no float tolerance)', () => {
    expect(computeTag({ valence: -t, arousal: 0, dominance: 0 })).toBe('low');
    expect(computeTag({ valence: t, arousal: 0, dominance: 0 })).toBe('calm');
    expect(computeTag({ valence: 0, arousal: t, dominance: 0 })).toBe('neutral');
    expect(computeTag({ valence: 0, arousal: t + 0.01, dominance: 0 })).toBe('curious');
  });

  it('clamps before partitioning', () => {
    expect(computeTag({ valence: -5, arousal: 5, dominance: 0 })).toBe('tense');
    expect(computeTag({ valence: 5, arousal: -5, dominance: 0 })).toBe('calm');
  });
});