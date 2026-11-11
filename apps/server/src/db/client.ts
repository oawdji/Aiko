import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export type Db = BetterSQLite3Database;

export type DbHandle = {
  sqlite: Database.Database;
  db: Db;
  databasePath: string;
};

/**
 * 按 database-schema.md §8 打开数据库：
 * - 外键必须显式启用；
 * - WAL 提升本地读写体验；
 * - busy_timeout 减少短暂写锁立即失败。
 * M1.2 落地 schema 后，将把表定义传入 drizzle() 获得类型化查询。
 */
export function createDb(databasePath: string): DbHandle {
  mkdirSync(path.dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath);

  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');

  const db = drizzle(sqlite);

  return { sqlite, db, databasePath };
}