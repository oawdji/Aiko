import { describe, expect, it } from 'vitest';
import { extractFacts, parseFactsResponse } from '../extractor';
import { computeHalfLifeHours, MEMORY_BASE_HALF_LIFE_HOURS } from '../gating';
import type { CompleteFn } from '../types';

const ok = (raw: string): CompleteFn => async () => raw;

describe('parseFactsResponse tolerance', () => {
  it('parses a plain JSON object', () => {
    const r = parseFactsResponse(
      '{"facts":[{"type":"fact","content":"用户正在学做饭","confidence":0.95}]}',
    );
    expect(r.error).toBeNull();
    expect(r.facts).toEqual([
      { type: 'fact', content: '用户正在学做饭', confidence: 0.95 },
    ]);
  });

  it('parses JSON wrapped in markdown fences', () => {
    const r = parseFactsResponse(
      '```json\n{"facts":[{"type":"goal","content":"用户的目标是考驾照","confidence":0.9}]}\n```',
    );
    expect(r.error).toBeNull();
    expect(r.facts[0]?.type).toBe('goal');
  });

  it('parses JSON embedded in surrounding prose', () => {
    const r = parseFactsResponse(
      '好的，抽取结果如下：{"facts":[{"type":"fact","content":"用户在上海工作","confidence":0.85}]} 以上。',
    );
    expect(r.error).toBeNull();
    expect(r.facts).toHaveLength(1);
  });

  it('returns error for non-JSON output', () => {
    expect(parseFactsResponse('今天天气不错').error).toBe('no JSON object found in response');
    expect(parseFactsResponse('{"facts": broken}').error).toBe('invalid JSON in response');
    expect(parseFactsResponse('{"msg":"hi"}').error).toBe('missing facts array');
  });

  it('drops entries with unknown type or empty content but keeps valid ones', () => {
    const r = parseFactsResponse(
      '{"facts":[' +
        '{"type":"gossip","content":"无效类型","confidence":0.9},' +
        '{"type":"fact","content":"","confidence":0.9},' +
        '{"type":"preference","content":"用户偏好简短回答","confidence":0.8}]}',
    );
    expect(r.facts).toEqual([
      { type: 'preference', content: '用户偏好简短回答', confidence: 0.8 },
    ]);
  });

  it('clamps out-of-range confidence and caps fact count at 5', () => {
    const facts = Array.from({ length: 8 }, (_, i) =>
      JSON.stringify({ type: 'fact', content: `事实${i}`, confidence: i === 0 ? 5 : -1 }),
    ).join(',');
    const r = parseFactsResponse(`{"facts":[${facts}]}`);
    expect(r.facts).toHaveLength(5);
    for (const f of r.facts) {
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('extractFacts', () => {
  it('returns empty for blank input without calling the LLM', async () => {
    let called = 0;
    const complete: CompleteFn = async () => {
      called += 1;
      return '{"facts":[]}';
    };
    const r = await extractFacts(complete, '   ');
    expect(r.facts).toEqual([]);
    expect(called).toBe(0);
  });

  it('propagates LLM failure as error, never throws', async () => {
    const complete: CompleteFn = async () => {
      throw new Error('network down');
    };
    const r = await extractFacts(complete, '我在学做饭');
    expect(r.facts).toEqual([]);
    expect(r.error).toBe('network down');
  });

  it('extracts facts on the happy path', async () => {
    const r = await extractFacts(
      ok('{"facts":[{"type":"fact","content":"用户正在学做饭","confidence":0.95}]}'),
      '我最近在学做饭',
    );
    expect(r.error).toBeNull();
    expect(r.facts).toHaveLength(1);
  });
});

describe('half-life gating (§4.3)', () => {
  it('scales half life linearly with arousal', () => {
    expect(computeHalfLifeHours(MEMORY_BASE_HALF_LIFE_HOURS, 0)).toBe(72);
    expect(computeHalfLifeHours(MEMORY_BASE_HALF_LIFE_HOURS, 0.3)).toBeCloseTo(93.6);
    expect(computeHalfLifeHours(MEMORY_BASE_HALF_LIFE_HOURS, 1)).toBe(144);
  });

  it('clamps out-of-range arousal', () => {
    expect(computeHalfLifeHours(72, -0.5)).toBe(72);
    expect(computeHalfLifeHours(72, 2)).toBe(144);
  });
});
