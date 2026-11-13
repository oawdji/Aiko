import { describe, expect, it } from 'vitest';
import { createEmotionEngine, resolveEmotionEngineId } from '../emotion-engine';
import type { CompleteFn } from '../../extraction/types';

describe('emotion engine switch', () => {
  it('resolves engine id from env-like value', () => {
    expect(resolveEmotionEngineId(undefined)).toBe('rules-v1');
    expect(resolveEmotionEngineId('rules-v1')).toBe('rules-v1');
    expect(resolveEmotionEngineId('llm-v1')).toBe('llm-v1');
    expect(resolveEmotionEngineId('off')).toBe('off');
    expect(resolveEmotionEngineId('bogus')).toBe('rules-v1');
  });

  it('off engine never extracts', () => {
    const engine = createEmotionEngine('off');
    expect(engine('今天好累')).toBeNull();
    expect(engine('好开心')).toBeNull();
    expect(engine('')).toBeNull();
  });

  it('rules-v1 engine delegates to extractEmotion', async () => {
    const engine = createEmotionEngine('rules-v1');
    expect((await engine('今天好累'))?.evidenceText).toBe('累');
    expect(engine('今天天气不错')).toBeNull();
  });

  it('llm-v1 engine works without complete by degrading to rules', async () => {
    const engine = createEmotionEngine('llm-v1');
    expect((await engine('今天好累'))?.evidenceText).toBe('累');
    expect(await engine('今天天气不错')).toBeNull();
  });

  it('llm-v1 engine uses the injected complete function', async () => {
    const complete: CompleteFn = async () =>
      JSON.stringify({
        emotion: {
          delta: { valence: -0.1, arousal: 0.05, dominance: 0 },
          confidence: 0.8,
          evidenceText: '算了',
          reason: '放弃语气。',
        },
      });
    const engine = createEmotionEngine('llm-v1', complete);
    const result = await engine('算了，随便你');
    expect(result).not.toBeNull();
    expect(result!.evidenceText).toBe('算了');
  });
});


