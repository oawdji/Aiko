import { describe, expect, it } from 'vitest';
import type { ProactiveConfig } from '../config';
import { inQuietWindow, shouldProactive } from '../policy';

const MIN = 60000;

function config(overrides: Partial<ProactiveConfig> = {}): ProactiveConfig {
  return {
    enabled: true,
    idleMinutes: 30,
    maxPer24h: 3,
    quietStart: '22:00',
    quietEnd: '08:00',
    minIntervalMinutes: 60,
    ...overrides,
  };
}

/** T0 = 2026-11-17 12:00 UTC = 20:00 本地（UTC+8，非免打扰时段） */
const T0 = Date.parse('2026-11-17T12:00:00.000Z');
const LOCAL_MINUTES = 20 * 60; // 本地 20:00

function base(overrides: Partial<Parameters<typeof shouldProactive>[0]> = {}) {
  return {
    config: config(),
    nowMs: T0,
    localMinutesOfDay: LOCAL_MINUTES,
    lastUserMessageAtMs: T0 - 60 * MIN,
    lastProactiveAtMs: null,
    proactiveCount24h: 0,
    ...overrides,
  };
}

describe('shouldProactive', () => {
  it('allows when all conditions met', () => {
    const r = shouldProactive(base());
    expect(r).toEqual({ allow: true, reason: 'ok' });
  });

  it('rejects when disabled (highest priority)', () => {
    const r = shouldProactive(base({ config: config({ enabled: false }) }));
    expect(r).toEqual({ allow: false, reason: 'disabled' });
  });

  it('rejects at daily cap', () => {
    const r = shouldProactive(base({ proactiveCount24h: 3 }));
    expect(r.reason).toBe('daily_cap');
  });

  it('rejects within cooldown after last proactive', () => {
    const r = shouldProactive(base({ lastProactiveAtMs: T0 - 30 * MIN }));
    expect(r.reason).toBe('cooldown');
  });

  it('allows again after cooldown passes', () => {
    const r = shouldProactive(base({ lastProactiveAtMs: T0 - 61 * MIN }));
    expect(r.reason).toBe('ok');
  });

  it('rejects during quiet hours', () => {
    // 本地 23:00 → 分钟数 1380
    const r = shouldProactive(base({ localMinutesOfDay: 23 * 60 }));
    expect(r.reason).toBe('quiet_hours');
  });

  it('handles overnight quiet window edge (early morning)', () => {
    // 本地 07:00（< 08:00 end，跨午夜窗口内）
    const r = shouldProactive(base({ localMinutesOfDay: 7 * 60 }));
    expect(r.reason).toBe('quiet_hours');
  });

  it('treats start === end as no quiet window', () => {
    const r = shouldProactive(base({ config: config({ quietStart: '22:00', quietEnd: '22:00' }), localMinutesOfDay: 22 * 60 }));
    expect(r.reason).toBe('ok');
  });

  it('rejects when user was active more recently than idle threshold', () => {
    const r = shouldProactive(base({ lastUserMessageAtMs: T0 - 10 * MIN }));
    expect(r.reason).toBe('not_idle');
  });

  it('allows when user has never sent a message (fresh install)', () => {
    const r = shouldProactive(base({ lastUserMessageAtMs: null }));
    expect(r.reason).toBe('ok');
  });

  it('respects custom idle threshold', () => {
    const r = shouldProactive(
      base({ config: config({ idleMinutes: 120 }), lastUserMessageAtMs: T0 - 90 * MIN }),
    );
    expect(r.reason).toBe('not_idle');
  });

  it('priority: disabled wins over daily_cap', () => {
    const r = shouldProactive(base({ config: config({ enabled: false }), proactiveCount24h: 3 }));
    expect(r.reason).toBe('disabled');
  });
});

describe('inQuietWindow', () => {
  it('normal window (12:00-14:00)', () => {
    expect(inQuietWindow(12 * 60 + 30, '12:00', '14:00')).toBe(true);
    expect(inQuietWindow(14 * 60, '12:00', '14:00')).toBe(false);
    expect(inQuietWindow(11 * 60, '12:00', '14:00')).toBe(false);
  });

  it('overnight window (22:00-08:00)', () => {
    expect(inQuietWindow(23 * 60, '22:00', '08:00')).toBe(true);
    expect(inQuietWindow(5 * 60, '22:00', '08:00')).toBe(true);
    expect(inQuietWindow(12 * 60, '22:00', '08:00')).toBe(false);
  });

  it('invalid HH:MM falls back to no window', () => {
    expect(inQuietWindow(22 * 60, '25:00', '08:00')).toBe(false);
  });
});
