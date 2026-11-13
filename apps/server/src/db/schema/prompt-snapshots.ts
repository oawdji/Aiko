import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { agents } from './agents';
import { conversations } from './conversations';

/**
 * Prompt 快照（F36 调试模式，memory-emotion-design.md §7.3）。
 * 仅在 app_settings.debug_mode 开启时写入；保留最近 N 条由查询侧裁剪。
 */
export const promptSnapshots = sqliteTable(
  'prompt_snapshots',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userMessageId: text('user_message_id'),
    systemText: text('system_text').notNull(),
    memoryIdsJson: text('memory_ids_json').notNull().default('[]'),
    recentWindowCount: text('recent_window_count').notNull().default('0'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('prompt_snapshots_conversation_idx').on(t.conversationId),
    index('prompt_snapshots_created_idx').on(t.createdAt),
  ],
);

export type PromptSnapshot = typeof promptSnapshots.$inferSelect;
export type NewPromptSnapshot = typeof promptSnapshots.$inferInsert;
