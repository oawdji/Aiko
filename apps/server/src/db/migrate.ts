import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { DbHandle } from './client';

/**
 * 执行 drizzle 迁移（幂等）：
 * 已应用的迁移记录在 __drizzle_migrations 表中，重复调用只执行新增部分。
 */
export function runMigrations(handle: DbHandle, migrationsFolder: string): void {
  migrate(handle.db, { migrationsFolder });
}