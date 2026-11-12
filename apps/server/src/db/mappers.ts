import {
  AgentDTOSchema,
  ChatMessageDTOSchema,
  ConversationDTOSchema,
} from '@aiko/shared';
import type { agents, conversations, messages, stateEvents } from './schema';

type AgentRow = typeof agents.$inferSelect;
type ConversationRow = typeof conversations.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
type StateEventRow = typeof stateEvents.$inferSelect;

/**
 * snake_case 数据库行 → shared camelCase DTO。
 * M2.3 抽取为独立模块，bootstrap 与 conversations 两个领域服务共用，
 * 避免 feature 之间相互 import。映射结果全部经 shared schema 出口校验。
 */

export function mapAgentRow(row: AgentRow) {
  return AgentDTOSchema.parse({
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    description: row.description,
    currentState: {
      valence: row.currentValence,
      arousal: row.currentArousal,
      // dominance 列待 T3 迁移 agents 表后接入，暂为 0
      dominance: 0,
    },
    currentTag: row.currentTag,
    stateUpdatedAt: row.stateUpdatedAt,
    // 基线/衰减参数列待 T3 迁移后接入，暂为中性默认
    emotionBaseline: { valence: 0, arousal: 0, dominance: 0 },
    decayHalfLifeHours: null,
    personaVersion: row.activePersonaVersion,
  });
}

export function mapConversationRow(row: ConversationRow) {
  return ConversationDTOSchema.parse({
    id: row.id,
    agentId: row.agentId,
    title: row.title,
    lastMessageAt: row.lastMessageAt,
    isArchived: row.isArchived === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function mapMessageRow(row: MessageRow) {
  return ChatMessageDTOSchema.parse({
    id: row.id,
    conversationId: row.conversationId,
    agentId: row.agentId,
    role: row.role,
    content: row.content,
    status: row.status,
    errorCode: row.errorCode,
    createdAt: row.createdAt,
  });
}

export function mapStateEventRow(row: StateEventRow) {
  return {
    id: row.id,
    agentId: row.agentId,
    conversationId: row.conversationId,
    triggerMessageId: row.triggerMessageId,
    source: row.source,
    ruleVersion: row.ruleVersion,
    before: { valence: row.beforeValence, arousal: row.beforeArousal, dominance: 0 },
    delta: { valence: row.deltaValence, arousal: row.deltaArousal, dominance: 0 },
    after: { valence: row.afterValence, arousal: row.afterArousal, dominance: 0 },
    discreteTag: row.discreteTag,
    reason: row.reason,
    evidenceText: row.evidenceText,
    confidence: row.confidence,
    createdAt: row.createdAt,
  };
}