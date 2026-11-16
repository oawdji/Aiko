import { randomUUID } from 'node:crypto';
import {
  InvalidMemoryTransitionError,
  type MemoryFactDTO,
  type MemoryListQuery,
  type MemoryPatchBody,
  type MemoryType,
} from '@aiko/shared';
import type { DbHandle } from '../db/client';
import type { MemoryOwner } from './repository';
import {
  findMemoryById,
  insertMemory,
  listActiveByType,
  listMemories,
  markOutdated,
  toDto,
  updateMemoryRow,
} from './repository';

/**
 * memories service：状态流转与冲突处理的唯一入口（memory-emotion-design.md §4.5）。
 * route 层不得直写 status；检索/注入只认 service 返回的数据。
 */

export class MemoryNotFoundError extends Error {
  constructor(memoryId: string) {
    super(`Memory "${memoryId}" not found for this owner`);
    this.name = 'MemoryNotFoundError';
  }
}

const ACTIVE_THRESHOLD_CONFIDENCE = 0.7;
/** 低风险类型：高置信度冲突可自动 outdated 旧事实（F16 §4.5）。 */
const AUTO_OUTDATED_TYPES: ReadonlySet<MemoryType> = new Set(['fact', 'goal']);

export type CreateMemoryInput = {
  owner: MemoryOwner;
  type: MemoryType;
  content: string;
  sourceMessageId: string;
  confidence: number;
  memoryPad: { v: number; a: number; d: number };
  arousal: number;
  halfLifeHours: number;
  now: string;
};

export function createMemory(
  handle: DbHandle,
  input: CreateMemoryInput,
): { memory: MemoryFactDTO; outdatedIds: string[] } {
  const status =
    input.confidence >= ACTIVE_THRESHOLD_CONFIDENCE ? 'active' : 'candidate';

  // 冲突处理（F16）：不同内容且低风险 → 自动 outdated 同 type 旧事实；
  // 高风险/低置信度 → 保持双候选，交用户在查看器裁决。
  let outdatedIds: string[] = [];
  if (status === 'active' && AUTO_OUTDATED_TYPES.has(input.type)) {
    const conflicting = listActiveByType(handle, input.owner, input.type).filter(
      (m) => m.content.toLowerCase() !== input.content.toLowerCase(),
    );
    outdatedIds = conflicting.map((m) => m.id);
  }

  const row = insertMemory(handle, {
    id: `mem_${randomUUID()}`,
    userId: input.owner.userId,
    agentId: input.owner.agentId,
    type: input.type,
    content: input.content,
    sourceMessageId: input.sourceMessageId,
    confidence: input.confidence,
    status,
    memoryPad: input.memoryPad,
    arousal: input.arousal,
    halfLifeHours: input.halfLifeHours,
    strength: 1,
    createdAt: input.now,
    updatedAt: input.now,
  });

  if (outdatedIds.length > 0) markOutdated(handle, outdatedIds, input.now);

  return { memory: toDto(row), outdatedIds };
}

function requireMemory(handle: DbHandle, owner: MemoryOwner, id: string) {
  const row = findMemoryById(handle, owner, id);
  if (!row) throw new MemoryNotFoundError(id);
  return row;
}

type MemoryStatusValue = MemoryFactDTO['status'];

function transition(
  handle: DbHandle,
  owner: MemoryOwner,
  id: string,
  to: MemoryStatusValue,
): MemoryFactDTO {
  const row = requireMemory(handle, owner, id);
  const from = row.status as MemoryStatusValue;
  const now = new Date().toISOString();

  const allowed: Record<MemoryStatusValue, readonly MemoryStatusValue[]> = {
    candidate: ['active', 'rejected', 'deleted'],
    active: ['outdated', 'deleted'],
    outdated: ['active', 'deleted'],
    rejected: ['deleted'],
    deleted: [],
  };
  if (!allowed[from].includes(to)) {
    throw new InvalidMemoryTransitionError(id, from, to);
  }

  return toDto(updateMemoryRow(handle, id, { status: to, updatedAt: now }));
}

/** 用户确认候选事实：candidate -> active。已 active 时幂等返回。 */
export function confirmMemory(
  handle: DbHandle,
  owner: MemoryOwner,
  id: string,
): MemoryFactDTO {
  const row = requireMemory(handle, owner, id);
  if (row.status === 'active') return toDto(row);
  return transition(handle, owner, id, 'active');
}

/** 用户拒绝候选事实：candidate -> rejected。已 rejected 时幂等返回。 */
export function rejectMemory(
  handle: DbHandle,
  owner: MemoryOwner,
  id: string,
): MemoryFactDTO {
  const row = requireMemory(handle, owner, id);
  if (row.status === 'rejected') return toDto(row);
  return transition(handle, owner, id, 'rejected');
}

/** 软删（F18）：任何非 deleted 状态 -> deleted；重复删除幂等返回。 */
export function deleteMemory(
  handle: DbHandle,
  owner: MemoryOwner,
  id: string,
): MemoryFactDTO {
  const row = requireMemory(handle, owner, id);
  if (row.status === 'deleted') return toDto(row);
  return transition(handle, owner, id, 'deleted');
}

/** 修正内容/类型（F17）。deleted/rejected 不可修正。 */
export function patchMemory(
  handle: DbHandle,
  owner: MemoryOwner,
  id: string,
  patch: MemoryPatchBody,
): MemoryFactDTO {
  const row = requireMemory(handle, owner, id);
  if (row.status === 'deleted' || row.status === 'rejected') {
    throw new InvalidMemoryTransitionError(id, row.status, row.status);
  }
  return toDto(
    updateMemoryRow(handle, id, {
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      updatedAt: new Date().toISOString(),
    }),
  );
}

/** 恢复过时记忆：outdated -> active（F20 手动恢复入口）。 */
export function restoreMemory(
  handle: DbHandle,
  owner: MemoryOwner,
  id: string,
): MemoryFactDTO {
  return transition(handle, owner, id, 'active');
}

export function getMemories(
  handle: DbHandle,
  owner: MemoryOwner,
  query: MemoryListQuery,
): MemoryFactDTO[] {
  return listMemories(handle, owner, query);
}
