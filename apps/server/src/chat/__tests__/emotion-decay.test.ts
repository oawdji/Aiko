import { describe, expect, it } from 'vitest';
import { DECAY_EPSILON, DEFAULT_DECAY_HALF_LIFE_HOURS } from '@aiko/shared';
import { resolveDecayConfig, revertToBaseline } from '../emotion-decay';

const ZERO_BASELINE = { valence: 0, arousal: 0, dominance: 0 };
const CONFIG = resolveDecayConfig(null);

describe('resolveDecayConfig', () => {
  it('falls back to the global default when the agent param is null/undefined', () => {
    expect(resolveDecayConfig(null)).toEqual({
      halfLifeHours: DEFAULT_DECAY_HALF_LIFE_HOURS,
      epsilon: DECAY_EPSILON,
    });
    expect(resolveDecayConfig(undefined).halfLifeHours).toBe(DEFAULT_DECAY_HALF_LIFE_HOURS);
  });

  it('prefers the agent-level half-life when present', () => {
    expect(resolveDecayConfig(2).halfLifeHours).toBe(2);
  });
});

describe('revertToBaseline', () => {
  it('returns the state unchanged for zero or negative elapsed time', () => {
    const state = { valence: 0.4, arousal: -0.2, dominance: 0.1 };
    expect(revertToBaseline(state, ZERO_BASELINE, 0, CONFIG)).toEqual(state);
    expect(revertToBaseline(state, ZERO_BASELINE, -5, CONFIG)).toEqual(state);
  });

  it('halves the distance to baseline after one half-life', () => {
    const state = { valence: 0.8, arousal: -0.4, dominance: 0.1 };
    const reverted = revertToBaseline(state, ZERO_BASELINE, DEFAULT_DECAY_HALF_LIFE_HOURS, CONFIG);
    expect(reverted.valence).toBeCloseTo(0.4, 10);
    expect(reverted.arousal).toBeCloseTo(-0.2, 10);
    expect(reverted.dominance).toBeCloseTo(0.05, 10);
  });

  it('reduces distance to a quarter after two half-lives', () => {
    const state = { valence: 0.8, arousal: 0, dominance: 0 };
    const reverted = revertToBaseline(state, ZERO_BASELINE, DEFAULT_DECAY_HALF_LIFE_HOURS * 2, CONFIG);
    expect(reverted.valence).toBeCloseTo(0.2, 10);
  });

  it('snaps to baseline within epsilon for very large elapsed time', () => {
    const state = { valence: 0.8, arousal: -0.4, dominance: 0.1 };
    const reverted = revertToBaseline(state, ZERO_BASELINE, 24 * 30, CONFIG);
    expect(reverted).toEqual(ZERO_BASELINE);
  });

  it('keeps a state already at baseline unchanged', () => {
    const baseline = { valence: 0.05, arousal: -0.02, dominance: 0 };
    expect(revertToBaseline(baseline, baseline, 100, CONFIG)).toEqual(baseline);
  });

  it('regresses each dimension independently toward its own baseline', () => {
    const baseline = { valence: 0.1, arousal: -0.1, dominance: 0.2 };
    const state = { valence: 0.6, arousal: -0.6, dominance: 0.2 };
    const reverted = revertToBaseline(state, baseline, DEFAULT_DECAY_HALF_LIFE_HOURS, CONFIG);
    expect(reverted.valence).toBeCloseTo(0.35, 10);
    expect(reverted.arousal).toBeCloseTo(-0.35, 10);
    expect(reverted.dominance).toBe(baseline.dominance); // 距离 < ε 吸附
  });

  it('converges monotonically toward the baseline (property)', () => {
    const state = { valence: 0.8, arousal: 0, dominance: 0 };
    let prev = Math.abs(state.valence);
    for (let h = 1; h <= 24; h += 1) {
      const reverted = revertToBaseline(state, ZERO_BASELINE, h, CONFIG);
      const dist = Math.abs(reverted.valence - ZERO_BASELINE.valence);
      expect(dist).toBeLessThanOrEqual(prev);
      prev = dist;
    }
  });
});
