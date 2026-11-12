import { describe, expect, it } from 'vitest';
import { AgentEmotionStateSchema } from '../schemas/emotion';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '../constants/ids';
import { DEFAULT_DECAY_HALF_LIFE_HOURS, DECAY_EPSILON } from '../types/decay';

describe('@aiko/shared smoke', () => {
  it('validates a valid PAD emotion state', () => {
    const result = AgentEmotionStateSchema.safeParse({ valence: 0, arousal: 0, dominance: 0 });
    expect(result.success).toBe(true);
  });

  it('rejects out-of-range or missing dominance', () => {
    expect(
      AgentEmotionStateSchema.safeParse({ valence: 1.5, arousal: 0, dominance: 0 }).success,
    ).toBe(false);
    expect(
      AgentEmotionStateSchema.safeParse({ valence: 0, arousal: 0, dominance: 2 }).success,
    ).toBe(false);
    expect(
      AgentEmotionStateSchema.safeParse({ valence: 0, arousal: 0 }).success,
    ).toBe(false);
  });

  it('exposes stable local identity constants', () => {
    expect(LOCAL_USER_ID).toBe('local-user');
    expect(DEFAULT_AGENT_ID).toBe('agent-default');
  });

  it('exposes decay defaults', () => {
    expect(DEFAULT_DECAY_HALF_LIFE_HOURS).toBe(6);
    expect(DECAY_EPSILON).toBe(0.001);
  });
});
