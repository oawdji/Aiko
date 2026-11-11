import { describe, expect, it } from 'vitest';
import { AgentEmotionStateSchema } from '../schemas/emotion';
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '../constants/ids';

describe('@aiko/shared smoke', () => {
  it('validates a valid emotion state', () => {
    const result = AgentEmotionStateSchema.safeParse({ valence: 0, arousal: 0 });
    expect(result.success).toBe(true);
  });

  it('rejects out-of-range values', () => {
    const result = AgentEmotionStateSchema.safeParse({ valence: 1.5, arousal: 0 });
    expect(result.success).toBe(false);
  });

  it('exposes stable local identity constants', () => {
    expect(LOCAL_USER_ID).toBe('local-user');
    expect(DEFAULT_AGENT_ID).toBe('agent-default');
  });
});