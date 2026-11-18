/**
 * 语义检索 TS 侧客户端(T7)。
 *
 * 通过子进程调用 Python CLI(services/retrieval/cli.py),JSON 进出。
 * 降级约定(契约 §T7):Python 缺失/模型未装/任何异常 → 返回空结果并打日志,
 * 对话流程绝不因记忆检索中断。首次失败后本进程内禁用,避免每轮重复付 spawn 成本。
 */

import { spawn } from 'node:child_process';
import type { PromptMessage } from './recent-window';

export interface MemoryClient {
  /** 对话入库(用户+助手一轮)。失败不抛错。 */
  indexDialogue(messages: PromptMessage[]): Promise<void>;
  /** 语义检索,返回记忆文本列表。失败返回空数组。 */
  search(query: string, topK: number): Promise<string[]>;
  /** 清空全部对话向量(清空会话时调用)。失败不抛错。 */
  clearVectors(): Promise<void>;
}

export const noopMemoryClient: MemoryClient = {
  async indexDialogue() {},
  async search() {
    return [];
  },
  async clearVectors() {},
};

export type CliResult = { ok: true; hits?: string[] } | { ok: false; error: string };

function runCli(cliPath: string, pythonExe: string, request: unknown, timeoutMs: number): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonExe, [cliPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('memory cli timeout'));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as CliResult;
        if (code === 0 && parsed.ok) resolve(parsed);
        else reject(new Error('ok' in parsed && !parsed.ok ? parsed.error : `cli exited ${code}`));
      } catch {
        reject(new Error(`invalid cli output (exit ${code})`));
      }
    });
    child.stdin.write(JSON.stringify(request));
    child.stdin.end();
  });
}

export function createPythonMemoryClient(options?: {
  pythonExe?: string;
  cliPath?: string;
  /** 测试注入:替身 runCli 实现 */
  runCliImpl?: typeof runCli;
  /** 每次真实调用后的状态回调(透明降级:状态经 settings API 暴露) */
  onResult?: (ok: boolean, error?: string) => void;
}): MemoryClient {
  const pythonExe = options?.pythonExe ?? process.env.PYTHON_EXECUTABLE ?? 'python';
  const cliPath =
    options?.cliPath ?? new URL('../../../../services/retrieval/cli.py', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const run = options?.runCliImpl ?? runCli;
  let disabled = false;

  const call = async (request: unknown): Promise<CliResult | null> => {
    if (disabled) return null;
    try {
      const result = await run(cliPath, pythonExe, request, 30_000);
      options?.onResult?.(true);
      return result;
    } catch (error) {
      disabled = true; // 进程内禁用:环境不可用时不再每轮重试
      const reason = error instanceof Error ? error.message : String(error);
      console.warn('[memory] retrieval disabled after failure:', reason);
      options?.onResult?.(false, reason);
      return null;
    }
  };

  return {
    async indexDialogue(messages) {
      if (messages.length === 0) return;
      await call({ op: 'index', messages });
    },
    async search(query, topK) {
      const result = await call({ op: 'search', query, top_k: topK });
      return result && result.ok ? (result.hits ?? []) : [];
    },
    async clearVectors() {
      await call({ op: 'clear' });
    },
  };
}

// ---------------------------------------------------------------------------
// 共享单例 + 检索状态（透明降级）：
// 此前每个聊天请求都新建 client 实例，"首次失败进程内禁用"并未跨请求生效，
// 且降级只写日志、用户不可见。现在共享一个实例并记录最近一次真实调用的结果，
// 经 GET /api/settings 的 memory 字段暴露给前端。
// ---------------------------------------------------------------------------

export type MemoryRetrievalState = 'unverified' | 'ok' | 'degraded';

let sharedClient: MemoryClient | null = null;
let retrievalStatus: { state: MemoryRetrievalState; reason: string | null } = {
  state: 'unverified',
  reason: null,
};

export function getMemoryRetrievalStatus(): { state: MemoryRetrievalState; reason: string | null } {
  return { ...retrievalStatus };
}

/** 进程级共享 client：跨请求保留"已禁用"状态与检索状态。 */
export function getSharedMemoryClient(): MemoryClient {
  if (!sharedClient) {
    sharedClient = createPythonMemoryClient({
      onResult: (ok, error) => {
        retrievalStatus = ok
          ? { state: 'ok', reason: null }
          : { state: 'degraded', reason: error ?? '未知错误' };
      },
    });
  }
  return sharedClient;
}