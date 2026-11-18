import { describe, expect, it } from 'vitest';
import type { PersonaEvolvable, PersonaPatch } from '@aiko/shared';
import { PersonaPatchError } from '../errors';
import { applyPatch, validatePatchLimits } from '../patch';

const base: PersonaEvolvable = {
  verbosity: 'balanced',
  warmth: 0.6,
  humor: 0.3,
  proactiveQuestions: 0.4,
  notes: [],
};

describe('validatePatchLimits', () => {
  it('rejects empty patch', () => {
    expect(() => validatePatchLimits({}, base)).toThrow(PersonaPatchError);
  });

  it('accepts a patch within step limits', () => {
    expect(() => validatePatchLimits({ warmth: 0.8 }, base)).not.toThrow();
    expect(() => validatePatchLimits({ verbosity: 'concise' }, base)).not.toThrow();
  });

  it('rejects numeric step exceeding 0.2', () => {
    expect(() => validatePatchLimits({ warmth: 1 }, base)).toThrow(PersonaPatchError);
    expect(() => validatePatchLimits({ humor: 0.6 }, base)).toThrow(PersonaPatchError);
    expect(() => validatePatchLimits({ proactiveQuestions: 0 }, base)).toThrow(PersonaPatchError);
  });

  it('allows exact boundary step of 0.2', () => {
    expect(() => validatePatchLimits({ warmth: 0.4 }, base)).not.toThrow();
  });
});

describe('applyPatch', () => {
  it('merges only provided fields and keeps notes untouched', () => {
    const next = applyPatch(base, { warmth: 0.7 } as PersonaPatch);
    expect(next).toEqual({ ...base, warmth: 0.7 });
  });

  it('throws on empty patch via applyPatch', () => {
    expect(() => applyPatch(base, {})).toThrow(PersonaPatchError);
  });

  it('does not mutate the input object', () => {
    applyPatch(base, { warmth: 0.8 });
    expect(base.warmth).toBe(0.6);
  });
});
