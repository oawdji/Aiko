import { randomUUID } from 'node:crypto';
import {
  PERSONA_PENDING_MAX,
  PERSONA_PROPOSAL_COOLDOWN_MINUTES,
  PERSONA_PROPOSAL_TTL_HOURS,
  PersonaEvolvableFromDbSchema,
  PersonaPatchSchema,
  type PersonaEvolvable,
  type PersonaPatch,
  type PersonaProposalDTO,
  type PersonaProposalSource,
  type PersonaProposalStatus,
  type PersonaVersionDTO,
} from '@aiko/shared';
import type { DbHandle } from '../db/client';
import { buildDiffSummary } from './diff';
import {
  PersonaBaseChangedError,
  PersonaNoActivePersonaError,
  PersonaPatchError,
  PersonaProposalNotFoundError,
  PersonaProposalStateError,
  PersonaRateLimitedError,
  PersonaVersionNotFoundError,
} from './errors';
import {
  createDefaultPersonaComplete,
  parsePatchResponse,
  type PersonaCompleteFn,
} from './llm';
import { applyPatch, validatePatchLimits } from './patch';
import { PERSONA_PROPOSE_SYSTEM_PROMPT, buildProposeUserPrompt } from './prompts';
import {
  countPendingProposals,
  deactivateOtherPersonaVersions,
  getActivePersona,
  getActivePersonaVersionRow,
  getLastProposalCreatedAt,
  getPersonaVersionRow,
  getProposalRow,
  getMaxPersonaVersion,
  insertPersonaVersionRow,
  insertProposalRow,
  listPersonaVersionRows,
  listProposalRows,
  updateAgentPersonaPointer,
  updateProposalStatus,
} from './repository';

function parseEvableJson(json: string): PersonaEvolvable | null {
  try {
    const parsed = PersonaEvolvableFromDbSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function toProposalDto(row: ReturnType<typeof getProposalRow> & object): PersonaProposalDTO {
  let patch: PersonaPatch;
  try {
    patch = PersonaPatchSchema.parse(JSON.parse(row.patchJson));
  } catch {
    patch = {};
  }
  return {
    id: row.id,
    agentId: row.agentId,
    baseVersion: row.baseVersion,
    requestText: row.requestText,
    patch,
    diffSummary: row.diffSummary,
    status: row.status as PersonaProposalStatus,
    source: row.source as PersonaProposalSource,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
  };
}

function toVersionDto(row: ReturnType<typeof getPersonaVersionRow> & object): PersonaVersionDTO | null {
  const evolvable = parseEvableJson(row.evolvableJson);
  if (!evolvable) return null;
  return {
    version: row.version,
    personaCoreHash: row.personaCoreHash,
    evolvable,
    isActive: row.isActive === 1,
    createdAt: row.createdAt,
    activatedAt: row.activatedAt,
  };
}

/**
 * 生成提案（P2 核心流程）：
 * LLM 结构化输出 → schema 校验 → 幅度校验（超限拒绝，不自动截断）→ 落库 pending。
 * 频率限制（F25）：同 agent 同时仅 1 条 pending；距上一条提案不足冷却时间拒绝。
 */
export async function proposePersona(
  handle: DbHandle,
  input: { agentId: string; requestText: string; now: string },
  complete: PersonaCompleteFn = createDefaultPersonaComplete(handle),
): Promise<PersonaProposalDTO> {
  const { agentId, requestText, now } = input;

  if (countPendingProposals(handle, agentId) >= PERSONA_PENDING_MAX) {
    throw new PersonaRateLimitedError('已有一条待确认提案，请先处理后再生成新的提案');
  }
  const lastCreatedAt = getLastProposalCreatedAt(handle, agentId);
  if (lastCreatedAt) {
    const elapsedMin = (Date.parse(now) - Date.parse(lastCreatedAt)) / 60000;
    if (elapsedMin >= 0 && elapsedMin < PERSONA_PROPOSAL_COOLDOWN_MINUTES) {
      throw new PersonaRateLimitedError(
        `提案间隔过短，请 ${PERSONA_PROPOSAL_COOLDOWN_MINUTES} 分钟后再试`,
      );
    }
  }

  const active = getActivePersona(handle, agentId);
  if (!active) throw new PersonaNoActivePersonaError(agentId);

  const raw = await complete({
    system: PERSONA_PROPOSE_SYSTEM_PROMPT,
    prompt: buildProposeUserPrompt(requestText, active.evolvable),
  });
  const { patch, error } = parsePatchResponse(raw);
  if (!patch) {
    throw new PersonaPatchError(`提案生成失败：${error}`);
  }
  validatePatchLimits(patch, active.evolvable);
  const next = applyPatch(active.evolvable, patch);
  const diffSummary = buildDiffSummary(active.evolvable, next);
  const expiresAt = new Date(
    Date.parse(now) + PERSONA_PROPOSAL_TTL_HOURS * 3600000,
  ).toISOString();

  const row = insertProposalRow(handle, {
    id: `prop_${randomUUID()}`,
    agentId,
    baseVersion: active.version,
    requestText,
    patchJson: JSON.stringify(patch),
    diffSummary,
    status: 'pending',
    source: 'user_request',
    expiresAt,
    createdAt: now,
    reviewedAt: null,
  });
  return toProposalDto(row);
}

/**
 * 确认提案——唯一的人格写路径。单事务：
 * 复核 pending/过期 → base_version 并发守卫 → 复核补丁 → 新版本行 → 指针切换 → 提案 approved。
 */
export function approveProposal(
  handle: DbHandle,
  agentId: string,
  proposalId: string,
  now: string,
): { version: number; evolvable: PersonaEvolvable } {
  const proposal = getProposalRow(handle, agentId, proposalId);
  if (!proposal) throw new PersonaProposalNotFoundError(proposalId);

  if (proposal.status !== 'pending') {
    throw new PersonaProposalStateError(
      `提案状态为 ${proposal.status}，只有 pending 提案可以确认`,
    );
  }
  if (Date.parse(proposal.expiresAt) < Date.parse(now)) {
    updateProposalStatus(handle, agentId, proposalId, 'expired', now);
    throw new PersonaProposalStateError('提案已过期，请重新生成');
  }

  const activeRow = getActivePersonaVersionRow(handle, agentId);
  if (!activeRow) throw new PersonaNoActivePersonaError(agentId);
  if (proposal.baseVersion !== activeRow.version) {
    throw new PersonaBaseChangedError(proposal.baseVersion, activeRow.version);
  }

  let patch: PersonaPatch;
  try {
    patch = PersonaPatchSchema.parse(JSON.parse(proposal.patchJson));
  } catch {
    throw new PersonaPatchError('提案中的补丁数据无效');
  }
  const current = parseEvableJson(activeRow.evolvableJson);
  if (!current) throw new PersonaNoActivePersonaError(agentId);
  validatePatchLimits(patch, current);
  const next = applyPatch(current, patch);
  const newVersion = getMaxPersonaVersion(handle, agentId) + 1;

  handle.sqlite.transaction(() => {
    // 顺序约束：persona_versions 的 partial unique index（agent_id WHERE is_active=1）
    // 要求先停用旧活跃行，再插入新 active 行
    deactivateOtherPersonaVersions(handle, agentId, newVersion);
    insertPersonaVersionRow(handle, {
      id: `persona_${randomUUID()}`,
      agentId,
      version: newVersion,
      personaCoreMd: activeRow.personaCoreMd,
      personaCoreHash: activeRow.personaCoreHash,
      evolvableJson: JSON.stringify(next),
      isActive: 1,
      createdAt: now,
      activatedAt: now,
    });
    updateAgentPersonaPointer(handle, agentId, newVersion, now);
    updateProposalStatus(handle, agentId, proposalId, 'approved', now);
  })();

  return { version: newVersion, evolvable: next };
}

/** 拒绝提案：仅 pending 可拒绝；拒绝后提案不再生效。 */
export function rejectProposal(
  handle: DbHandle,
  agentId: string,
  proposalId: string,
  now: string,
): PersonaProposalDTO {
  const proposal = getProposalRow(handle, agentId, proposalId);
  if (!proposal) throw new PersonaProposalNotFoundError(proposalId);
  if (proposal.status !== 'pending') {
    throw new PersonaProposalStateError(
      `提案状态为 ${proposal.status}，只有 pending 提案可以拒绝`,
    );
  }
  const row = updateProposalStatus(handle, agentId, proposalId, 'rejected', now);
  return toProposalDto(row);
}

/**
 * 回滚到历史版本（追加式，F27）：不修改任何历史行——插入新版本行（内容 = 目标版本），
 * 并写入一条 source=rollback 的已批准提案记录保证审计链完整。
 */
export function rollbackToVersion(
  handle: DbHandle,
  agentId: string,
  targetVersion: number,
  now: string,
): { version: number; evolvable: PersonaEvolvable } {
  const target = getPersonaVersionRow(handle, agentId, targetVersion);
  if (!target) throw new PersonaVersionNotFoundError(targetVersion);
  const activeRow = getActivePersonaVersionRow(handle, agentId);
  if (!activeRow) throw new PersonaNoActivePersonaError(agentId);
  if (target.version === activeRow.version) {
    throw new PersonaProposalStateError(`版本 ${targetVersion} 已是活跃版本`);
  }
  const current = parseEvableJson(activeRow.evolvableJson);
  const targetEvolvable = parseEvableJson(target.evolvableJson);
  if (!current || !targetEvolvable) throw new PersonaNoActivePersonaError(agentId);

  const diffSummary = buildDiffSummary(current, targetEvolvable);
  const newVersion = getMaxPersonaVersion(handle, agentId) + 1;

  handle.sqlite.transaction(() => {
    // 顺序约束同 approveProposal：先停用旧活跃行
    deactivateOtherPersonaVersions(handle, agentId, newVersion);
    insertPersonaVersionRow(handle, {
      id: `persona_${randomUUID()}`,
      agentId,
      version: newVersion,
      personaCoreMd: target.personaCoreMd,
      personaCoreHash: target.personaCoreHash,
      evolvableJson: target.evolvableJson,
      isActive: 1,
      createdAt: now,
      activatedAt: now,
    });
    updateAgentPersonaPointer(handle, agentId, newVersion, now);
    insertProposalRow(handle, {
      id: `prop_${randomUUID()}`,
      agentId,
      baseVersion: activeRow.version,
      requestText: `回滚到 v${targetVersion}`,
      patchJson: '{}',
      diffSummary,
      status: 'approved',
      source: 'rollback',
      expiresAt: now,
      createdAt: now,
      reviewedAt: now,
    });
  })();

  return { version: newVersion, evolvable: targetEvolvable };
}

// ---------------------------------------------------------------------------
// 查询（P3 route / UI 使用）
// ---------------------------------------------------------------------------

export function listProposals(
  handle: DbHandle,
  agentId: string,
  opts: { status?: PersonaProposalStatus; limit?: number; offset?: number } = {},
): PersonaProposalDTO[] {
  return listProposalRows(handle, agentId, opts).map(toProposalDto);
}

export function listPersonaVersions(handle: DbHandle, agentId: string): PersonaVersionDTO[] {
  return listPersonaVersionRows(handle, agentId)
    .map(toVersionDto)
    .filter((v): v is PersonaVersionDTO => v !== null);
}
