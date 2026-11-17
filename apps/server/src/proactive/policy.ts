import type { ProactiveConfig } from './config';

export type ProactivePolicyInput = {
  config: ProactiveConfig;
  /** 评估时刻的 epoch 毫秒（服务端时钟；DB 时间同为 UTC，间隔比较无时区问题） */
  nowMs: number;
  /** 客户端本地当天的分钟数（0–1439，前端由其本地时钟计算）——免打扰窗口判断 */
  localMinutesOfDay: number;
  /** 用户最后一条消息的 epoch 毫秒（无任何消息时为 null） */
  lastUserMessageAtMs: number | null;
  /** 上一次主动消息的 epoch 毫秒 */
  lastProactiveAtMs: number | null;
  /** 滚动 24h 内已发送的主动消息数 */
  proactiveCount24h: number;
};

export type ProactivePolicyReason =
  | 'ok'
  | 'disabled'
  | 'daily_cap'
  | 'cooldown'
  | 'quiet_hours'
  | 'not_idle';

export type ProactivePolicyResult = {
  allow: boolean;
  reason: ProactivePolicyReason;
};

function parseHHMM(v: string): number | null {
  const m = v.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 是否处于免打扰窗口；start === end 视为无窗口。支持跨午夜（如 22:00–08:00）。 */
export function inQuietWindow(minutesOfDay: number, start: string, end: string): boolean {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s === null || e === null || s === e) return false;
  if (s < e) return minutesOfDay >= s && minutesOfDay < e;
  return minutesOfDay >= s || minutesOfDay < e;
}

/**
 * 时机守门员（纯函数，无 IO）：判断此刻是否允许主动发消息。
 * 只回答“什么时候可以发”，不回答“说什么”（内容策略在 strategy 层）。
 * 判定顺序即 reason 优先级：disabled → daily_cap → cooldown → quiet_hours → not_idle → ok。
 */
export function shouldProactive(input: ProactivePolicyInput): ProactivePolicyResult {
  const { config } = input;
  if (!config.enabled) {
    return { allow: false, reason: 'disabled' };
  }
  if (input.proactiveCount24h >= config.maxPer24h) {
    return { allow: false, reason: 'daily_cap' };
  }
  if (
    input.lastProactiveAtMs !== null &&
    input.nowMs - input.lastProactiveAtMs < config.minIntervalMinutes * 60000
  ) {
    return { allow: false, reason: 'cooldown' };
  }
  if (inQuietWindow(input.localMinutesOfDay, config.quietStart, config.quietEnd)) {
    return { allow: false, reason: 'quiet_hours' };
  }
  if (
    input.lastUserMessageAtMs !== null &&
    input.nowMs - input.lastUserMessageAtMs < config.idleMinutes * 60000
  ) {
    return { allow: false, reason: 'not_idle' };
  }
  return { allow: true, reason: 'ok' };
}
