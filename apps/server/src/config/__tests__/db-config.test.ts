import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDbConfig } from '../db';

describe('loadDbConfig', () => {
  it('defaults to the repo-root data directory', () => {
    const config = loadDbConfig({});

    // __tests__ -> config -> src -> server -> apps -> 仓库根
    const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
    expect(config.dataDir).toBe(path.join(repoRoot, 'data'));
    expect(config.databasePath).toBe(path.join(repoRoot, 'data', 'agent.sqlite'));
  });

  it('honors the DATA_DIR override', () => {
    const config = loadDbConfig({ DATA_DIR: 'D:/tmp/aiko-data' });

    expect(config.dataDir).toBe(path.resolve('D:/tmp/aiko-data'));
    expect(config.databasePath).toBe(
      path.join(path.resolve('D:/tmp/aiko-data'), 'agent.sqlite'),
    );
  });

  it('ignores whitespace-only DATA_DIR', () => {
    const config = loadDbConfig({ DATA_DIR: '   ' });

    expect(path.basename(config.dataDir)).toBe('data');
  });
});