/**
 * Memory Retriever 插件挂载点（Phase 1）。
 *
 * 语义检索后端可替换：内置为 Python CLI 实现（bge-base-zh 向量检索），
 * 未安装 Python/模型时自动降级（noop），聊天不受影响——降级状态经
 * getMemoryRetrievalStatus() 对设置面板透明（见 memory-client.ts）。
 */

import {
  getSharedMemoryClient,
  noopMemoryClient,
  type MemoryClient,
} from '../chat/memory-client';
import { createRegistry, type PluginDescriptor } from './registry';

export type MemoryRetrieverPlugin = PluginDescriptor & {
  client(): MemoryClient;
};

export const memoryRetrieverRegistry = createRegistry<MemoryRetrieverPlugin>();

memoryRetrieverRegistry.register({
  id: 'builtin.semantic-python',
  description: 'bge-base-zh 向量语义检索（Python CLI 子进程，失败进程内降级）',
  client: () => getSharedMemoryClient(),
});

memoryRetrieverRegistry.register({
  id: 'builtin.noop',
  description: '禁用语义检索（永远返回空结果；FTS5 语义项不受影响）',
  client: () => noopMemoryClient,
});

/** 默认检索器 = 注册表第一个插件。 */
export function getDefaultMemoryRetriever(): MemoryRetrieverPlugin {
  const first = memoryRetrieverRegistry.all()[0];
  if (!first) {
    throw new Error('no memory retriever plugin registered');
  }
  return first;
}