import { describe, expect, it } from 'vitest';
import { createEmotionEngine, resolveEmotionEngineId } from '../emotion-engine';

describe('emotion engine switch', () => {
  it('resolves engine id from env-like value', () => {
    expect(resolveEmotionEngineId(undefined)).toBe('rules-v1');
    expect(resolveEmotionEngineId('rules-v1')).toBe('rules-v1');
    expect(resolveEmotionEngineId('off')).toBe('off');
    expect(resolveEmotionEngineId('bogus')).toBe('rules-v1');
  });

  it('off engine never extracts', () => {
    const engine = createEmotionEngine('off');
    expect(engine('今天好累')).toBeNull();
    expect(engine('好开心')).toBeNull();
    expect(engine('')).toBeNull();
  });

  it('rules-v1 engine delegates to extractEmotion', () => {
    const engine = createEmotionEngine('rules-v1');
    expect(engine('今天好累')?.evidenceText).toBe('累');
    expect(engine('今天天气不错')).toBeNull();
  });
});