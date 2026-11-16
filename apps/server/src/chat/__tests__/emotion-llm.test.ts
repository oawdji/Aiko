import { describe, expect, it, afterEach, vi } from 'vitest';
import {
  EMOTION_DELTA_LIMIT,
  applyEmotion,
  buildEmotionInstruction,
  clampState,
  computeTag,
  isEmotionEngineEnabled,
  parseEmotionMarker,
} from '../emotion-llm';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildEmotionInstruction', () => {
  it('returns protocol text by default and empty when off', () => {
    expect(buildEmotionInstruction()).toContain('[[emotion:');
    vi.stubEnv('EMOTION_ENGINE', 'off');
    expect(buildEmotionInstruction()).toBe('');
    expect(isEmotionEngineEnabled()).toBe(false);
  });
});

describe('parseEmotionMarker', () => {
  it('parses a valid marker and strips it from the reply', () => {
    const raw = '今天真开心。\n[[emotion: happy | 4 | 聊到喜欢的事]]';
    const parsed = parseEmotionMarker(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.cleanText).toBe('今天真开心。');
    expect(parsed!.tag).toBe('happy');
    // happy|4 → scale 0.8: v=0.2, a=0.16, d=0.08
    expect(parsed!.extraction!.delta.valence).toBeCloseTo(0.2, 5);
    expect(parsed!.extraction!.delta.arousal).toBeCloseTo(0.16, 5);
    expect(parsed!.extraction!.reason).toBe('聊到喜欢的事');
    expect(parsed!.extraction!.confidence).toBeCloseTo(0.88, 5);
  });

  it('returns null for missing or non-tail markers', () => {
    expect(parseEmotionMarker('没有标记')).toBeNull();
    expect(parseEmotionMarker('[[emotion: low | 3 | x]] 后面还有话')).toBeNull();
  });

  it('strips malformed markers but returns null extraction', () => {
    for (const raw of ['正文\n[[emotion: angry | 3 | 非法标签]]', '正文\n[[emotion: low | 9 | 强度越界]]']) {
      const parsed = parseEmotionMarker(raw);
      expect(parsed!.cleanText).toBe('正文');
      expect(parsed!.extraction).toBeNull();
    }
  });

  it('still strips the marker when engine is off, extraction not gated here', () => {
    vi.stubEnv('EMOTION_ENGINE', 'off');
    const parsed = parseEmotionMarker('好的。\n[[emotion: calm | 2 | 轻松]]');
    expect(parsed && parsed.cleanText).toBe('好的。');
  });
});

describe('emotion state math', () => {
  it('clamps deltas to the per-event limit', () => {
    expect(clampState(2)).toBe(1);
    expect(clampState(-2)).toBe(-1);
    const { after, delta } = applyEmotion(
      { valence: 0, arousal: 0, dominance: 0 },
      { delta: { valence: 1, arousal: -1, dominance: 0 }, confidence: 1, evidenceText: '', reason: '' },
    );
    expect(after.valence).toBe(EMOTION_DELTA_LIMIT);
    expect(after.arousal).toBe(-EMOTION_DELTA_LIMIT);
    expect(delta.valence).toBe(EMOTION_DELTA_LIMIT);
  });

  it('maps state partitions to discrete tags', () => {
    expect(computeTag({ valence: -0.2, arousal: 0.2, dominance: 0 })).toBe('tense');
    expect(computeTag({ valence: -0.2, arousal: -0.2, dominance: 0 })).toBe('low');
    expect(computeTag({ valence: 0.2, arousal: 0.2, dominance: 0 })).toBe('happy');
    expect(computeTag({ valence: 0.2, arousal: -0.2, dominance: 0 })).toBe('calm');
    expect(computeTag({ valence: 0, arousal: 0.2, dominance: 0 })).toBe('curious');
    expect(computeTag({ valence: 0, arousal: 0, dominance: 0 })).toBe('neutral');
  });
});
