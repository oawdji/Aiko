import { z } from 'zod';
import { PERSONA_NOTES_MAX } from '../constants/persona';

export const PersonaVerbositySchema = z.enum(['concise', 'balanced', 'detailed']);
export type PersonaVerbosity = z.infer<typeof PersonaVerbositySchema>;

/**
 * 可演化配置（camelCase 对外契约）。
 * 注意：DB 中 v1 存量为 snake_case（proactive_questions），由 server 侧 repository 读取时归一化。
 */
export const PersonaEvolvableSchema = z.object({
  verbosity: PersonaVerbositySchema,
  warmth: z.number().min(0).max(1),
  humor: z.number().min(0).max(1),
  proactiveQuestions: z.number().min(0).max(1),
  /** 第一版 patch 不允许修改 notes（字段保留，二期开放）。 */
  notes: z.array(z.string()).max(PERSONA_NOTES_MAX),
});
export type PersonaEvolvable = z.infer<typeof PersonaEvolvableSchema>;

/**
 * DB 读取归一化：v1 存量 JSON 为 snake_case（proactive_questions），统一转 camelCase。
 * server repository 使用本 schema 解析 persona_versions.evolvable_json。
 */
export const PersonaEvolvableFromDbSchema = z.preprocess((raw) => {
  if (raw !== null && typeof raw === 'object' && 'proactive_questions' in (raw as Record<string, unknown>)) {
    const obj = { ...(raw as Record<string, unknown>) };
    obj.proactiveQuestions = obj.proactive_questions;
    delete obj.proactive_questions;
    return obj;
  }
  return raw;
}, PersonaEvolvableSchema);

/** persona_versions 行 DTO（对外契约，不含内部列）。 */
export const PersonaVersionDTOSchema = z.object({
  version: z.number().int().min(1),
  personaCoreHash: z.string(),
  evolvable: PersonaEvolvableSchema,
  isActive: z.boolean(),
  createdAt: z.string(),
  activatedAt: z.string().nullable(),
});
export type PersonaVersionDTO = z.infer<typeof PersonaVersionDTOSchema>;
