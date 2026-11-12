import { sql } from 'drizzle-orm';
import {
  check,
  index,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';
import { agents } from './agents';
import { conversations } from './conversations';

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'restrict' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),
    userId: text('user_id').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    status: text('status').notNull(),
    clientMessageId: text('client_message_id'),
    errorCode: text('error_code'),
    metadataJson: text('metadata_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check(
      'messages_role_enum',
      sql`${t.role} IN ('user', 'assistant', 'system')`,
    ),
    check(
      'messages_status_enum',
      sql`${t.status} IN ('streaming', 'complete', 'failed')`,
    ),
    check(
      'messages_user_requires_client_message_id',
      sql`${t.role} <> 'user' OR ${t.clientMessageId} IS NOT NULL`,
    ),
    check(
      'messages_failed_requires_error_code',
      sql`${t.status} <> 'failed' OR ${t.errorCode} IS NOT NULL`,
    ),
    check(
      'messages_metadata_json_valid',
      sql`${t.metadataJson} IS NULL OR json_valid(${t.metadataJson})`,
    ),
    unique('messages_conversation_client_message_unique').on(
      t.conversationId,
      t.clientMessageId,
    ),
    index('messages_conversation_created_idx').on(
      t.conversationId,
      sql`${t.createdAt} desc`,
    ),
    index('messages_agent_created_idx').on(
      t.agentId,
      sql`${t.createdAt} desc`,
    ),
    index('messages_status_idx').on(t.status),
  ],
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;