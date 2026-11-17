/**
 * 语义检索 TS 侧客户端(T7)。
 *
 * 通过子进程调用 Python CLI(services/retrieval/cli.py),JSON 进出。
 * 降级约定(契约 §T7):Python 缺失/模型未装/任何异常 → 返回空结果并打日志,
 * 对话流程绝不因记忆检索中断。首次失败后本进程内禁用,避免每轮重复付 spawn 成本。
 */

import { spawn } from 'node:child_process';
import { loadMemoryConfig } from '../config/memory';
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

type CliResult = { ok: true; hits?: string[] } | { ok: false; error: string };

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

export function createPythonMemoryClient(options?: { pythonExe?: string; cliPath?: string }): MemoryClient {
  const config = loadMemoryConfig();
  const pythonExe = options?.pythonExe ?? process.env.PYTHON_EXECUTABLE ?? 'python';
  const cliPath =
    options?.cliPath ?? new URL('../../../../services/retrieval/cli.py', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  let disabled = false;

  const call = async (request: unknown): Promise<CliResult | null> => {
    if (disabled) return null;
    try {
      return await runCli(cliPath, pythonExe, request, 30_000);
    } catch (error) {
      disabled = true; // 进程内禁用:环境不可用时不再每轮重试
      console.warn('[memory] retrieval disabled after failure:', error instanceof Error ? error.message : error);
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
