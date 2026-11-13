import { describe, expect, it, vi } from 'vitest';
import { createLlmEmotionEngine, extractJsonObject } from '../emotion-llm';
import type { CompleteFn } from '../../extraction/types';

function completeReturning(text: string): CompleteFn {
  return vi.fn().mockResolvedValue(text);
}

describe('extractJsonObject', () => {
  it('parses plain JSON', () => {
    expect(extractJsonObject('{"emotion":null}')).toEqual({ emotion: null });
  });

  it('parses JSON inside code fences and surrounding text', () => {
    expect(extractJsonObject('好的：\n```json\n{"emotion":null}\n```')).toEqual({
      emotion: null,
    });
  });

  it('throws when no object present', () => {
    expect(() => extractJsonObject('抱歉我无法回答')).toThrow();
  });
});

describe('createLlmEmotionEngine', () => {
  it('returns LLM extraction when output is valid', async () => {
    const engine = createLlmEmotionEngine(
      completeReturning(
        JSON.stringify({
          emotion: {
            delta: { valence: -0.5, arousal: 0.2, dominance: -0.1 },
            confidence: 0.9,
            evidenceText: '随便你',
            reason: '敷衍语气带有负面情绪。',
          },
        }),
      ),
    );
    const result = await engine('随便你吧');
    expect(result).not.toBeNull();
    // delta 超出单条上限 0.3 时截断
    expect(result!.delta.valence).toBe(-0.3);
    expect(result!.delta.arousal).toBe(0.2);
    expect(result!.evidenceText).toBe('随便你');
  });

  it('returns null when LLM judges no clear emotion', async () => {
    const engine = createLlmEmotionEngine(completeReturning('{"emotion":null}'));
    expect(await engine('今天周二')).toBeNull();
  });

  it('falls back to lexicon when LLM output is invalid', async () => {
    const engine = createLlmEmotionEngine(completeReturning('抱歉我无法回答'));
    const result = await engine('今天好累');
    expect(result).not.toBeNull();
    expect(result!.evidenceText).toBe('累');
  });

  it('falls back to lexicon when LLM call rejects', async () => {
    const complete: CompleteFn = vi.fn().mockRejectedValue(new Error('network down'));
    const engine = createLlmEmotionEngine(complete);
    const result = await engine('好开心');
    expect(result).not.toBeNull();
    expect(result!.evidenceText).toBe('开心');
  });

  it('degrades to lexicon-only when complete is not provided', async () => {
    const engine = createLlmEmotionEngine();
    expect((await engine('今天好累'))?.evidenceText).toBe('累');
    expect(await engine('今天天气不错')).toBeNull();
  });
});
