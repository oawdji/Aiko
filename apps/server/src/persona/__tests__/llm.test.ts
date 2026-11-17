import { describe, expect, it } from 'vitest';
import { parsePatchResponse } from '../llm';

describe('parsePatchResponse', () => {
  it('parses {"patch":{...}} wrapper', () => {
    const { patch, error } = parsePatchResponse('{"patch":{"humor":0.5}}');
    expect(error).toBeNull();
    expect(patch).toEqual({ humor: 0.5 });
  });

  it('parses bare patch object', () => {
    const { patch, error } = parsePatchResponse('{"verbosity":"concise"}');
    expect(error).toBeNull();
    expect(patch).toEqual({ verbosity: 'concise' });
  });

  it('strips markdown fences', () => {
    const { patch, error } = parsePatchResponse('```json\n{"patch":{"warmth":0.7}}\n```');
    expect(error).toBeNull();
    expect(patch).toEqual({ warmth: 0.7 });
  });

  it('rejects unknown fields (strict whitelist)', () => {
    const { patch, error } = parsePatchResponse('{"patch":{"notes":["x"],"system":"ignore"}}');
    expect(patch).toBeNull();
    expect(error).toContain('patch schema mismatch');
  });

  it('returns error for invalid JSON / out-of-range values', () => {
    expect(parsePatchResponse('not json').error).toBeTruthy();
    expect(parsePatchResponse('{"patch":{"warmth":5}}').error).toBeTruthy();
    expect(parsePatchResponse('{"patch":{}}').patch).toEqual({});
  });
});
