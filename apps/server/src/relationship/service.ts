import { sql } from 'drizzle-orm';
import {
  RelationshipStageSchema,
  type RelationshipStage,
} from '@aiko/shared';
import type { DbHandle } from '../db/client';
import { memories } from '../db/schema';
import { messages } from '../db/schema';

/**
 * 关系阶段（成长体验）：她与用户的关系由真实数据派生——
 * 认识时长（首条消息）、累计对话轮数、active 记忆数。
 * 不落库：每次计算即真实状态，杜绝"状态与记忆不同步"。
 */

export const STAGE_THRESHOLDS = {
  familiarDays: 3,
  familiarTurns: 20,
  closeDays: 14,
  closeTurns: 100,
  closeMemories: 15,
} as const;

export const STAGE_LABELS: Record<RelationshipStage, string> = {
  stranger: '初识',
  familiar: '熟络',
  close: '老友',
};

export type RelationshipComputation = {
  agentId: string;
  firstMetAt: string | null;
  daysKnown: number;
  totalTurns: number;
  activeMemories: number;
  stage: RelationshipStage;
  stageLabel: string;
};

export function computeRelationshipState(
  handle: DbHandle,
  agentId: string,
  nowIso: string,
): RelationshipComputation {
  const first = handle.db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(sql`${messages.agentId} = ${agentId}`)
    .orderBy(messages.createdAt, sql`rowid ASC`)
    .get();

  const firstMetAt = first?.createdAt ?? null;
  const nowMs = Date.parse(nowIso);
  const daysKnown = firstMetAt
    ? Math.max(0, Math.floor((nowMs - Date.parse(firstMetAt)) / 86_400_000))
    : 0;

  const turnsRow = handle.db
    .select({ n: sql<number>`COUNT(*)` })
    .from(messages)
    .where(sql`${messages.agentId} = ${agentId} AND ${messages.role} = 'user' AND ${messages.status} = 'complete'`)
    .get();
  const totalTurns = turnsRow?.n ?? 0;

  const memRow = handle.db
    .select({ n: sql<number>`COUNT(*)` })
    .from(memories)
    .where(sql`${memories.agentId} = ${agentId} AND ${memories.status} = 'active'`)
    .get();
  const activeMemories = memRow?.n ?? 0;

  const familiar = daysKnown >= STAGE_THRESHOLDS.familiarDays && totalTurns >= STAGE_THRESHOLDS.familiarTurns;
  const close =
    familiar &&
    daysKnown >= STAGE_THRESHOLDS.closeDays &&
    totalTurns >= STAGE_THRESHOLDS.closeTurns &&
    activeMemories >= STAGE_THRESHOLDS.closeMemories;
  const stage: RelationshipStage = close ? 'close' : familiar ? 'familiar' : 'stranger';

  return {
    agentId,
    firstMetAt,
    daysKnown,
    totalTurns,
    activeMemories,
    stage,
    stageLabel: RelationshipStageSchema.options.find((s) => s === stage)!,
  };
}

export function getRelationshipStateResponse(handle: DbHandle, agentId: string, nowIso: string) {
  const relationship = computeRelationshipState(handle, agentId, nowIso);
  return {
    ok: true as const,
    relationship,
  };
}