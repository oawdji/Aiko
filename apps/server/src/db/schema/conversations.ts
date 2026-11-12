import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { agents } from './agents';

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),
    title: text('title'),
    lastMessageAt: text('last_message_at'),
    isArchived: integer('is_archived').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('conversations_is_archived_flag', sql`${t.isArchived} IN (0, 1)`),
    index('conversations_agent_last_message_idx').on(
      t.agentId,
      sql`${t.lastMessageAt} desc`,
    ),
    index('conversations_user_agent_idx').on(t.userId, t.agentId),
  ],
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;