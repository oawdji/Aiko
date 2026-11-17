import {
  PERSONA_MAX_STEP,
  type PersonaEvolvable,
  type PersonaPatch,
} from '@aiko/shared';
import { PersonaPatchError } from './errors';

const NUMERIC_FIELDS = ['warmth', 'humor', 'proactiveQuestions'] as const;

/** 空补丁拒绝（LLM 判定无可抽取变更时上游会给出友好提示）。 */
export function assertPatchNotEmpty(patch: PersonaPatch): void {
  if (Object.keys(patch).length === 0) {
    throw new PersonaPatchError('提案补丁为空（没有任何字段变更）');
  }
}

/**
 * 幅度限制（F25）：数值字段单次 |Δ| <= PERSONA_MAX_STEP。
 * 超限直接拒绝，不自动截断——受控系统的第一美德是行为可预期。
 */
export function validatePatchLimits(patch: PersonaPatch, current: PersonaEvolvable): void {
  assertPatchNotEmpty(patch);
  for (const field of NUMERIC_FIELDS) {
    const next = patch[field];
    if (next === undefined) continue;
    const current_ = current[field];
    if (Math.abs(next - current_) > PERSONA_MAX_STEP + 1e-9) {
      throw new PersonaPatchError(
        `${field} 单次变化超过上限 ${PERSONA_MAX_STEP}（${current_} → ${next}），请分多次调整`,
      );
    }
  }
}

/** 把补丁应用到当前配置，返回新 evolvable（纯函数，不改传入对象）。 */
export function applyPatch(current: PersonaEvolvable, patch: PersonaPatch): PersonaEvolvable {
  assertPatchNotEmpty(patch);
  return {
    verbosity: patch.verbosity ?? current.verbosity,
    warmth: patch.warmth ?? current.warmth,
    humor: patch.humor ?? current.humor,
    proactiveQuestions: patch.proactiveQuestions ?? current.proactiveQuestions,
    notes: current.notes,
  };
}
