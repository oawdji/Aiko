import { sql } from 'drizzle-orm';
import {
  check,
  index,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { agents } from './agents';
import { conversations } from './conversations';
import { messages } from './messages';

/** 主动消息审计表（Phase 4）：策略/原因/证据可追溯，随会话与消息级联删除。 */
export const proactiveMessages = sqliteTable(
  'proactive_messages',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    /** 对应 messages 表中的 assistant 消息行 */
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    /** 触发策略：emotion_care / memory_recall / curious_question */
    strategy: text('strategy').notNull(),
    /** 触发原因（policy 通过时的判定说明） */
    reason: text('reason').notNull(),
    /** 证据文本（如：上次对话 valence -0.6 @ 时间 / 记忆 id） */
    evidenceText: text('evidence_text').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check(
      'proactive_messages_strategy_enum',
      sql`${t.strategy} IN ('emotion_care', 'memory_recall', 'curious_question')`,
    ),
    index('proactive_messages_agent_created_idx').on(t.agentId, t.createdAt),
    index('proactive_messages_conversation_idx').on(t.conversationId),
  ],
);

export type ProactiveMessage = typeof proactiveMessages.$inferSelect;
export type NewProactiveMessage = typeof proactiveMessages.$inferInsert;
