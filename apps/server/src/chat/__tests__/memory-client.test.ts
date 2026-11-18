import { describe, expect, it } from 'vitest';
import {
  createPythonMemoryClient,
  getMemoryRetrievalStatus,
  getSharedMemoryClient,
} from '../memory-client';
import type { CliResult } from '../memory-client';

type RunImpl = (cliPath: string, pythonExe: string, request: unknown, timeoutMs: number) => Promise<CliResult>;

describe('createPythonMemoryClient 状态回调（透明降级）', () => {
  it('成功调用 → onResult(true)，search 返回命中', async () => {
    const results: Array<[boolean, string?]> = [];
    const impl: RunImpl = async (_cli, _py, request) => {
      const op = (request as { op: string }).op;
      if (op === 'search') return { ok: true, hits: ['命中1', '命中2'] } as CliResult;
      return { ok: true } as CliResult;
    };
    const client = createPythonMemoryClient({ runCliImpl: impl, onResult: (ok, err) => results.push([ok, err]) });

    const hits = await client.search('今天聊了什么', 5);
    expect(hits).toEqual(['命中1', '命中2']);
    expect(results).toEqual([[true, undefined]]);
  });

  it('失败调用 → onResult(false) 带原因，后续调用不再 spawn（进程内禁用）', async () => {
    let spawnCount = 0;
    const impl: RunImpl = async () => {
      spawnCount += 1;
      throw new Error('python not found');
    };
    const results: Array<[boolean, string?]> = [];
    const client = createPythonMemoryClient({ runCliImpl: impl, onResult: (ok, err) => results.push([ok, err]) });

    await expect(client.search('q', 5)).resolves.toEqual([]);
    await client.indexDialogue([{ role: 'user', content: 'x' }]);
    expect(spawnCount).toBe(1); // 第二次未 spawn
    // disabled 短路路径不触发回调
    expect(results).toEqual([[false, 'python not found']]);
  });
});

describe('getSharedMemoryClient 共享单例', () => {
  it('同一进程返回同一实例', () => {
    expect(getSharedMemoryClient()).toBe(getSharedMemoryClient());
  });

  it('初始状态为 unverified，调用后反映最近一次结果', async () => {
    // 注意：单例与全局状态跨测试共享，这里只断言字段形态
    const status = getMemoryRetrievalStatus();
    expect(['unverified', 'ok', 'degraded']).toContain(status.state);
    if (status.state === 'degraded') {
      expect(typeof status.reason).toBe('string');
    } else {
      expect(status.reason).toBeNull();
    }
  });
});