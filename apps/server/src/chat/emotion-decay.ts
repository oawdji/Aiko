import type { AgentEmotionState, DecayConfig } from '@aiko/shared';
import { DECAY_EPSILON, DEFAULT_DECAY_HALF_LIFE_HOURS } from '@aiko/shared';

/**
 * 基线回归（时间衰减引擎）纯函数模块（technical-design.md §10.11）：
 * x' = μ + (x − μ) · e^(−θ·Δt)，θ = ln2 / halfLifeHours。
 * - OU 精确离散解，确定性、可复现；
 * - 零依赖：不 import DB / service，时间由 elapsedHours 显式注入；
 * - 回归不产生事件，由调用方折叠进下一条事件的 before。
 */

/**
 * 解析衰减配置：角色参数优先，全局默认兜底。
 * @param agentHalfLifeHours agents.decay_half_life_hours（可空）
 */
export function resolveDecayConfig(agentHalfLifeHours: number | null | undefined): DecayConfig {
  return {
    halfLifeHours: agentHalfLifeHours ?? DEFAULT_DECAY_HALF_LIFE_HOURS,
    epsilon: DECAY_EPSILON,
  };
}

/** 单维回归：μ + (x − μ)·e^(−θ·Δt)，距离 < ε 时吸附到 μ。 */
function revertDim(x: number, baseline: number, theta: number, elapsedHours: number, epsilon: number): number {
  const distance = x - baseline;
  if (Math.abs(distance) < epsilon) return baseline;
  const reverted = baseline + distance * Math.exp(-theta * elapsedHours);
  return Math.abs(reverted - baseline) < epsilon ? baseline : reverted;
}

/**
 * 将状态向角色基线回归 elapsedHours（三维独立）。
 * elapsedHours <= 0 时原样返回（不放大未来事件，防御时钟回拨/脏数据）。
 */
export function revertToBaseline(
  state: AgentEmotionState,
  baseline: AgentEmotionState,
  elapsedHours: number,
  config: DecayConfig,
): AgentEmotionState {
  if (elapsedHours <= 0) {
    return { ...state };
  }
  const theta = Math.LN2 / config.halfLifeHours;
  return {
    valence: revertDim(state.valence, baseline.valence, theta, elapsedHours, config.epsilon),
    arousal: revertDim(state.arousal, baseline.arousal, theta, elapsedHours, config.epsilon),
    dominance: revertDim(state.dominance, baseline.dominance, theta, elapsedHours, config.epsilon),
  };
}
