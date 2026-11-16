import { sql } from 'drizzle-orm';
import { check, index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { agents } from './agents';
import { conversations } from './conversations';
import { messages } from './messages';

/** 会话摘要记忆（F14），记录来源消息范围，异步生成、幂等、可删除。 */
export const conversationSummaries = sqliteTable(
  'conversation_summaries',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    startMessageId: text('start_message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'restrict' }),
    endMessageId: text('end_message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'restrict' }),
    content: text('content').notNull(),
    status: text('status').notNull().default('pending'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check(
      'conversation_summaries_status_enum',
      sql`${t.status} IN ('pending', 'ready', 'failed', 'deleted')`,
    ),
    index('conversation_summaries_conversation_idx').on(t.conversationId),
    index('conversation_summaries_agent_idx').on(t.agentId, t.status),
  ],
);

export type ConversationSummary = typeof conversationSummaries.$inferSelect;
export type NewConversationSummary = typeof conversationSummaries.$inferInsert;
