import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { PersonaEvolvableFromDbSchema, type PersonaEvolvable } from '@aiko/shared';
import { PERSONA_CORE_HASH, PERSONA_CORE_MD } from '../db/generated/persona-core';
import { personaVersions } from '../db/schema';
import type { DbHandle } from '../db/client';

/** 锚点完整性校验失败（F21 防漂移）：启动时 fail fast。 */
export class PersonaCoreIntegrityError extends Error {
  constructor(detail: string) {
    super(`Persona core integrity check failed: ${detail}`);
    this.name = 'PersonaCoreIntegrityError';
  }
}

export type ActivePersona = {
  version: number;
  evolvable: PersonaEvolvable;
  personaCoreMd: string;
};

/**
 * 读取当前活跃人格版本。解析失败降级为 null（聊天仅注入锚点，不注入风格段），
 * 不抛错——人格配置损坏不应阻断聊天。
 */
export function getActivePersona(handle: DbHandle, agentId: string): ActivePersona | null {
  const row = handle.db
    .select()
    .from(personaVersions)
    .where(and(eq(personaVersions.agentId, agentId), eq(personaVersions.isActive, 1)))
    .orderBy(desc(personaVersions.version))
    .get();
  if (!row) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(row.evolvableJson);
  } catch {
    console.warn(`[persona] invalid evolvable JSON at v${row.version}, skip style injection`);
    return null;
  }
  const parsed = PersonaEvolvableFromDbSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`[persona] evolvable schema mismatch at v${row.version}: ${parsed.error.message}`);
    return null;
  }
  return { version: row.version, evolvable: parsed.data, personaCoreMd: row.personaCoreMd };
}

/**
 * 启动校验（F21）：活跃版本的锚点正文必须与生成常量完全一致。
 * 任何不一致（被篡改 / 版本错乱）都拒绝启动，防止人格漂移。
 */
export function assertPersonaCoreIntact(handle: DbHandle, agentId: string): void {
  const row = handle.db
    .select({ md: personaVersions.personaCoreMd, version: personaVersions.version })
    .from(personaVersions)
    .where(and(eq(personaVersions.agentId, agentId), eq(personaVersions.isActive, 1)))
    .get();
  if (!row) {
    throw new PersonaCoreIntegrityError(`agent ${agentId} has no active persona version`);
  }
  const actual = createHash('sha256').update(row.md, 'utf8').digest('hex');
  if (row.md !== PERSONA_CORE_MD || actual !== PERSONA_CORE_HASH) {
    throw new PersonaCoreIntegrityError(
      `active persona v${row.version} core hash ${actual} != generated ${PERSONA_CORE_HASH}`,
    );
  }
}
