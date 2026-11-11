import path from 'node:path';

export type DbConfig = {
  dataDir: string;
  databasePath: string;
};

const DEFAULT_DB_FILE = 'agent.sqlite';

export function loadDbConfig(env: NodeJS.ProcessEnv = process.env): DbConfig {
  // apps/server/src/config -> 仓库根为上四级（config -> src -> server -> apps -> 根）
  const repoRoot = path.resolve(import.meta.dirname, '../../../..');

  const dataDir = env.DATA_DIR?.trim()
    ? path.resolve(env.DATA_DIR.trim())
    : path.join(repoRoot, 'data');

  return {
    dataDir,
    databasePath: path.join(dataDir, DEFAULT_DB_FILE),
  };
}