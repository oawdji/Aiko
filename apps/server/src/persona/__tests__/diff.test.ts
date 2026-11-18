import { describe, expect, it } from 'vitest';
import type { PersonaEvolvable } from '@aiko/shared';
import { buildDiffSummary } from '../diff';

const base: PersonaEvolvable = {
  verbosity: 'balanced',
  warmth: 0.6,
  humor: 0.3,
  proactiveQuestions: 0.4,
  notes: [],
};

describe('buildDiffSummary', () => {
  it('lists only changed fields', () => {
    const s = buildDiffSummary(base, { ...base, verbosity: 'concise', humor: 0.1 });
    expect(s).toContain('- 回答长度：均衡 → 简洁');
    expect(s).toContain('- 幽默程度：30% → 10%');
    expect(s).not.toContain('语气温度');
    expect(s).not.toContain('主动追问');
  });

  it('returns 无变化 for identical config', () => {
    expect(buildDiffSummary(base, { ...base })).toBe('无变化');
  });
});
