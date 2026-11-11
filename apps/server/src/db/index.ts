import { loadDbConfig } from '../config/db';
import { createDb, type DbHandle } from './client';

let instance: DbHandle | null = null;

export function getDb(): DbHandle {
  if (!instance) {
    const config = loadDbConfig();
    instance = createDb(config.databasePath);
  }
  return instance;
}

/** 仅测试使用：重置单例，便于切换临时数据目录。 */
export function resetDbForTest(): void {
  if (instance) {
    instance.sqlite.close();
    instance = null;
  }
}