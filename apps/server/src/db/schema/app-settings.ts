import { sql } from 'drizzle-orm';
import { check, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const appSettings = sqliteTable(
  'app_settings',
  {
    key: text('key').primaryKey(),
    valueJson: text('value_json').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check(
      'app_settings_value_json_valid',
      sql`json_valid(${t.valueJson})`,
    ),
  ],
);

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;