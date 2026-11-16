import { describe, expect, it, afterEach, vi } from 'vitest';
import {
  EMOTION_DELTA_LIMIT,
  applyEmotion,
  buildExtraction,
  clampState,
  computeTag,
  isEmotionEngineEnabled,
} from '../emotion-llm';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isEmotionEngineEnabled', () => {
  it('is on by default and off with EMOTION_ENGINE=off', () => {
    delete process.env.EMOTION_ENGINE;
    expect(isEmotionEngineEnabled()).toBe(true);
    vi.stubEnv('EMOTION_ENGINE', 'off');
    expect(isEmotionEngineEnabled()).toBe(false);
  });
});

describe('buildExtraction', () => {
  it('scales TAG_DELTA by intensity/5', () => {
    const e = buildExtraction('happy', 4, '聊到喜欢的事');
    expect(e.delta.valence).toBeCloseTo(0.2, 5);
    expect(e.delta.arousal).toBeCloseTo(0.16, 5);
    expect(e.delta.dominance).toBeCloseTo(0.08, 5);
    expect(e.reason).toBe('聊到喜欢的事');
    expect(e.evidenceText).toContain('happy(4/5)');
  });
  it('produces zero delta for neutral', () => {
    const e = buildExtraction('neutral', 3, '普通对话');
    expect(e.delta.valence).toBe(0);
    expect(e.delta.arousal).toBe(0);
    expect(e.delta.dominance).toBe(0);
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
