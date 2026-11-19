/**
 * 插件注册表（Phase 1：接口正式化）。
 *
 * 本模块只提供进程内的类型化注册机制：内置实现以"内置插件"身份在模块加载时注册，
 * 第三方（或测试）可通过同一 register API 追加。
 * Phase 2 再引入 plugin.json 清单、启停持久化与事件总线；本层不涉及 IO。
 */

export type PluginDescriptor = {
  /** 全局唯一 id，约定 builtin.* 为内置插件 */
  id: string;
  description?: string;
};

export class DuplicatePluginError extends Error {
  constructor(id: string) {
    super(`plugin id already registered: ${id}`);
    this.name = 'DuplicatePluginError';
  }
}

export type Registry<T extends PluginDescriptor> = {
  register(plugin: T): void;
  unregister(id: string): boolean;
  get(id: string): T | undefined;
  has(id: string): boolean;
  /** 注册顺序返回（稳定的内置顺序；需要排序的挂载点自行按字段排序） */
  all(): readonly T[];
  ids(): readonly string[];
};

export function createRegistry<T extends PluginDescriptor>(initial: T[] = []): Registry<T> {
  const byId = new Map<string, T>();
  const order: string[] = [];

  const register = (plugin: T): void => {
    if (byId.has(plugin.id)) {
      throw new DuplicatePluginError(plugin.id);
    }
    byId.set(plugin.id, plugin);
    order.push(plugin.id);
  };

  initial.forEach(register);

  return {
    register,
    unregister(id: string): boolean {
      if (!byId.delete(id)) return false;
      const index = order.indexOf(id);
      if (index >= 0) order.splice(index, 1);
      return true;
    },
    get: (id: string) => byId.get(id),
    has: (id: string) => byId.has(id),
    all: () => order.map((id) => byId.get(id)!),
    ids: () => [...order],
  };
}