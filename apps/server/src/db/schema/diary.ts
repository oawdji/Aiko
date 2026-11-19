import { index, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { agents } from './agents';

/**
 * 日记（虚拟人内心生活）：每日回顾（daily）与碎片想法（thought）。
 * - 不绑定会话：日记是她的跨会话私人记录，归属 agent；
 * - mood_* 为落笔那一刻的情绪快照（无情绪记录时可空）；
 * - daily 每日一篇（agent + date 部分唯一索引），惰性生成（bootstrap 补写昨日）。
 */
export const diaryEntries = sqliteTable(
  'diary_entries',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    /** 日记归属日期（本地时区 YYYY-MM-DD） */
    date: text('date').notNull(),
    type: text('type').notNull(),
    content: text('content').notNull(),
    moodValence: real('mood_valence'),
    moodArousal: real('mood_arousal'),
    moodDominance: real('mood_dominance'),
    source: text('source').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('diary_entries_agent_date_idx').on(t.agentId, t.date),
    uniqueIndex('diary_entries_daily_unique').on(t.agentId, t.date).where(sql`type = 'daily'`),
  ],
);

export type DiaryEntry = typeof diaryEntries.$inferSelect;
export type NewDiaryEntry = typeof diaryEntries.$inferInsert;