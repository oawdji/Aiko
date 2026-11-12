import { useSyncExternalStore } from 'react';

type Listener = () => void;

type StateUpdate<S> = Partial<S> | ((prev: S) => Partial<S>);

export type Store<S extends object> = {
  getState: () => S;
  setState: (update: StateUpdate<S>) => void;
  subscribe: (listener: Listener) => () => void;
};

/**
 * 零依赖最小 store（M2.5）：
 * - setState 采用浅合并语义（Partial），各业务 store 的 setter 因此可以只写增量；
 * - 无实际字段变化时不通知订阅者；
 * - API 形状与文档 §12 的 useAgentStateStore((s) => ...) 选择器用法兼容，
 *   未来如需换 zustand 只改本文件与各 store 的创建处。
 */
export function createStore<S extends object>(initialState: S): Store<S> {
  let state = initialState;
  const listeners = new Set<Listener>();

  return {
    getState: () => state,
    setState(update) {
      const patch = typeof update === 'function' ? update(state) : update;
      let changed = false;
      for (const key of Object.keys(patch) as Array<keyof S>) {
        if (!Object.is(patch[key], state[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<S extends object, R>(store: Store<S>, selector: (state: S) => R): R {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}