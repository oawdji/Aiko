import { appSettings } from '../db/schema';
import type { DbHandle } from '../db/client';

export type ProactiveConfig = {
  enabled: boolean;
  /** 空闲阈值（分钟）：用户最后一条消息距今超过该值才允许主动 */
  idleMinutes: number;
  /** 滚动 24h 内主动消息上限 */
  maxPer24h: number;
  /** 免打扰开始（本地 "HH:MM"） */
  quietStart: string;
  /** 免打扰结束（本地 "HH:MM"，支持跨午夜） */
  quietEnd: string;
  /** 两次主动消息的最小间隔（分钟） */
  minIntervalMinutes: number;
};

export const PROACTIVE_DEFAULTS: ProactiveConfig = {
  enabled: false,
  idleMinutes: 30,
  maxPer24h: 3,
  quietStart: '22:00',
  quietEnd: '08:00',
  minIntervalMinutes: 60,
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 从 app_settings 读取主动行为配置；缺失/损坏的键回退默认值（seed 已预置默认键）。 */
export function loadProactiveConfig(handle: DbHandle): ProactiveConfig {
  const rows = handle.db
    .select({ key: appSettings.key, valueJson: appSettings.valueJson })
    .from(appSettings)
    .all();
  const byKey: Record<string, string> = {};
  for (const r of rows) byKey[r.key] = r.valueJson;

  const bool = (key: string, fallback: boolean): boolean => {
    try {
      const v = JSON.parse(byKey[key] ?? '');
      return typeof v === 'boolean' ? v : fallback;
    } catch {
      return fallback;
    }
  };
  const num = (key: string, fallback: number, min: number, max: number): number => {
    try {
      const v = JSON.parse(byKey[key] ?? '');
      return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
    } catch {
      return fallback;
    }
  };
  const hhmm = (key: string, fallback: string): string => {
    try {
      const v = JSON.parse(byKey[key] ?? '');
      return typeof v === 'string' && HHMM.test(v) ? v : fallback;
    } catch {
      return fallback;
    }
  };

  return {
    enabled: bool('proactive_enabled', PROACTIVE_DEFAULTS.enabled),
    idleMinutes: num('proactive_idle_minutes', PROACTIVE_DEFAULTS.idleMinutes, 1, 1440),
    maxPer24h: num('proactive_max_per_24h', PROACTIVE_DEFAULTS.maxPer24h, 1, 50),
    quietStart: hhmm('proactive_quiet_start', PROACTIVE_DEFAULTS.quietStart),
    quietEnd: hhmm('proactive_quiet_end', PROACTIVE_DEFAULTS.quietEnd),
    minIntervalMinutes: num('proactive_min_interval_minutes', PROACTIVE_DEFAULTS.minIntervalMinutes, 0, 1440),
  };
}
