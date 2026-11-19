/**
 * 插件目录发现与加载（Phase 3）。
 *
 * - 扫描插件根目录的一级子目录，读取 plugin.json 并按 schema 校验；
 * - 声明式能力直接注册：contextContributors（{{today}} 插值）、uiLinks（前端插槽）；
 * - entry 指定的 ESM 入口以动态 import 加载，调用 default export 的 install(api)；
 * - 任何失败只 warn + 跳过该插件，绝不阻断服务启动。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PluginManifestSchema, type LoadedPluginInfo, type PluginManifest } from './manifest';
import { contextContributorRegistry } from './context-contributors';
import { getSharedMemoryClient } from '../chat/memory-client';
import { proactiveStrategyRegistry } from '../proactive/strategy';
import { emotionExtractorRegistry } from './emotion-extractors';
import { memoryRetrieverRegistry } from './retriever';
import { subscribe, type AikoEventMap, type AikoEventType } from './event-bus';
import { getDisabledPluginIds, setPluginEnabled } from './persistence';

const loadedPlugins: LoadedPluginInfo[] = [];

/** 供前端插槽（uiLinks）消费的已加载清单。 */
export function getLoadedPlugins(): readonly LoadedPluginInfo[] {
  return loadedPlugins;
}

export function resetLoadedPluginsForTests(): void {
  loadedPlugins.length = 0;
}

export type PluginHostApi = {
  contextContributorRegistry: typeof contextContributorRegistry;
  proactiveStrategyRegistry: typeof proactiveStrategyRegistry;
  emotionExtractorRegistry: typeof emotionExtractorRegistry;
  memoryRetrieverRegistry: typeof memoryRetrieverRegistry;
  subscribe: <K extends AikoEventType>(
    type: K,
    handler: (payload: AikoEventMap[K]) => void | Promise<void>,
  ) => () => void;
  persistence: {
    getDisabledPluginIds: typeof getDisabledPluginIds;
    setPluginEnabled: typeof setPluginEnabled;
  };
  memory: {
    getSharedMemoryClient: typeof getSharedMemoryClient;
  };
};

function defaultPluginsDir(): string {
  if (process.env.AIKO_PLUGINS_DIR) {
    return path.resolve(process.env.AIKO_PLUGINS_DIR);
  }
  // src/plugins/loader.ts → 上四级为仓库根
  return new URL('../../../../plugins/', import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    '$1',
  );
}

export function pluginsRootDir(): string {
  return defaultPluginsDir();
}

function interpolateTemplate(template: string, nowIso: string): string {
  const date = new Date(nowIso);
  const today = Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  return template.replaceAll('{{today}}', today);
}

async function loadOnePluginDir(pluginDir: string): Promise<void> {
  const manifestPath = path.join(pluginDir, 'plugin.json');
  if (!existsSync(manifestPath)) return;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (error) {
    console.warn(
      `[plugins] ${manifestPath} is not valid JSON, skipped:`,
      error instanceof Error ? error.message : error,
    );
    return;
  }

  const parsed = PluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(
      `[plugins] ${manifestPath} manifest invalid, skipped:`,
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
    return;
  }
  const manifest: PluginManifest = parsed.data;

  // 声明式上下文贡献
  for (const contrib of manifest.contextContributors ?? []) {
    const fullId = `${manifest.id}.${contrib.id}`;
    contextContributorRegistry.register({
      id: fullId,
      description: `${manifest.name}（声明式模板）`,
      order: contrib.order,
      contribute: (facts) => interpolateTemplate(contrib.template, facts.now),
    });
  }

  // 代码入口
  if (manifest.entry) {
    const entryPath = path.join(pluginDir, manifest.entry);
    const mod = (await import(pathToFileURL(entryPath).href)) as {
      install?: (api: PluginHostApi) => void | Promise<void>;
    };
    if (typeof mod.install !== 'function') {
      console.warn(`[plugins] ${manifest.id} entry has no install(api), skipped code entry`);
    } else {
      const api: PluginHostApi = {
        contextContributorRegistry,
        proactiveStrategyRegistry,
        emotionExtractorRegistry,
        memoryRetrieverRegistry,
        subscribe,
        persistence: { getDisabledPluginIds, setPluginEnabled },
        memory: { getSharedMemoryClient },
      };
      await mod.install(api);
    }
  }

  loadedPlugins.push({ manifest, dir: pluginDir });
  console.log(`[plugins] loaded: ${manifest.id}@${manifest.version} from ${pluginDir}`);
}

/**
 * 扫描并加载插件根目录。返回成功加载的清单列表。
 * 目录不存在 → 返回空数组（不视为错误）。
 */
export async function loadExternalPlugins(dir?: string): Promise<LoadedPluginInfo[]> {
  const root = dir ?? pluginsRootDir();
  if (!existsSync(root)) {
    return [];
  }
  let entries: string[];
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (error) {
    console.warn(
      `[plugins] failed to scan ${root}:`,
      error instanceof Error ? error.message : error,
    );
    return [];
  }
  for (const name of entries) {
    try {
      await loadOnePluginDir(path.join(root, name));
    } catch (error) {
      console.warn(
        `[plugins] failed to load plugin ${name}, skipped:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return [...loadedPlugins];
}