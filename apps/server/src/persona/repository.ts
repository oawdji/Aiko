import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { PersonaEvolvableFromDbSchema, type PersonaEvolvable } from '@aiko/shared';
import { PERSONA_CORE_HASH, PERSONA_CORE_MD } from '../db/generated/persona-core';
import {
  personaProposals,
  personaVersions,
  type NewPersonaProposal,
  type NewPersonaVersion,
  type PersonaProposal,
  type PersonaVersion,
} from '../db/schema';
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

// ---------------------------------------------------------------------------
// 提案与版本管理（P2）：persona_proposals / persona_versions 的唯一 SQL 出入口
// ---------------------------------------------------------------------------

export function getActivePersonaVersionRow(
  handle: DbHandle,
  agentId: string,
): PersonaVersion | null {
  return (
    handle.db
      .select()
      .from(personaVersions)
      .where(and(eq(personaVersions.agentId, agentId), eq(personaVersions.isActive, 1)))
      .orderBy(desc(personaVersions.version))
      .get() ?? null
  );
}

export function getPersonaVersionRow(
  handle: DbHandle,
  agentId: string,
  version: number,
): PersonaVersion | null {
  return (
    handle.db
      .select()
      .from(personaVersions)
      .where(and(eq(personaVersions.agentId, agentId), eq(personaVersions.version, version)))
      .get() ?? null
  );
}

export function getMaxPersonaVersion(handle: DbHandle, agentId: string): number {
  const row = handle.db
    .select({ version: personaVersions.version })
    .from(personaVersions)
    .where(eq(personaVersions.agentId, agentId))
    .orderBy(desc(personaVersions.version))
    .get();
  return row?.version ?? 0;
}

export function insertPersonaVersionRow(handle: DbHandle, values: NewPersonaVersion): PersonaVersion {
  return handle.db.insert(personaVersions).values(values).returning().get();
}

export function deactivateOtherPersonaVersions(
  handle: DbHandle,
  agentId: string,
  activeVersion: number,
): void {
  handle.sqlite
    .prepare(
      'UPDATE persona_versions SET is_active = 0, activated_at = activated_at WHERE agent_id = ? AND version != ?',
    )
    .run(agentId, activeVersion);
}

export function updateAgentPersonaPointer(
  handle: DbHandle,
  agentId: string,
  version: number,
  now: string,
): void {
  handle.sqlite
    .prepare('UPDATE agents SET active_persona_version = ?, updated_at = ? WHERE id = ?')
    .run(version, now, agentId);
}

export function insertProposalRow(handle: DbHandle, values: NewPersonaProposal): PersonaProposal {
  return handle.db.insert(personaProposals).values(values).returning().get();
}

export function getProposalRow(handle: DbHandle, agentId: string, id: string): PersonaProposal | null {
  return (
    handle.db
      .select()
      .from(personaProposals)
      .where(and(eq(personaProposals.agentId, agentId), eq(personaProposals.id, id)))
      .get() ?? null
  );
}

export function listProposalRows(
  handle: DbHandle,
  agentId: string,
  opts: { status?: PersonaProposal['status']; limit?: number; offset?: number } = {},
): PersonaProposal[] {
  const conditions = [eq(personaProposals.agentId, agentId)];
  if (opts.status) conditions.push(eq(personaProposals.status, opts.status));
  return handle.db
    .select()
    .from(personaProposals)
    .where(and(...conditions))
    .orderBy(desc(personaProposals.createdAt), desc(personaProposals.id))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0)
    .all();
}

export function countPendingProposals(handle: DbHandle, agentId: string): number {
  const row = handle.db
    .select({ n: sql<number>`count(*)` })
    .from(personaProposals)
    .where(
      and(eq(personaProposals.agentId, agentId), eq(personaProposals.status, 'pending')),
    )
    .get();
  return row?.n ?? 0;
}

export function getLastProposalCreatedAt(handle: DbHandle, agentId: string): string | null {
  const row = handle.db
    .select({ createdAt: personaProposals.createdAt })
    .from(personaProposals)
    .where(eq(personaProposals.agentId, agentId))
    .orderBy(desc(personaProposals.createdAt), desc(personaProposals.id))
    .get();
  return row?.createdAt ?? null;
}

export function updateProposalStatus(
  handle: DbHandle,
  agentId: string,
  id: string,
  status: PersonaProposal['status'],
  reviewedAt: string,
): PersonaProposal {
  return handle.db
    .update(personaProposals)
    .set({ status, reviewedAt })
    .where(and(eq(personaProposals.agentId, agentId), eq(personaProposals.id, id)))
    .returning()
    .get();
}

export function listPersonaVersionRows(handle: DbHandle, agentId: string): PersonaVersion[] {
  return handle.db
    .select()
    .from(personaVersions)
    .where(eq(personaVersions.agentId, agentId))
    .orderBy(desc(personaVersions.version))
    .all();
}
