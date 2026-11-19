import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { PluginManifestSchema } from '../manifest';
import {
  getLoadedPlugins,
  loadExternalPlugins,
  resetLoadedPluginsForTests,
} from '../loader';
import { contextContributorRegistry } from '../context-contributors';

function makePluginsRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'aiko-ext-plugins-'));
}

function writePlugin(
  root: string,
  dirName: string,
  manifest: unknown,
  entryCode?: string,
): string {
  const dir = path.join(root, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'plugin.json'),
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2),
    'utf-8',
  );
  if (entryCode) {
    writeFileSync(path.join(dir, 'index.mjs'), entryCode, 'utf-8');
  }
  return dir;
}

beforeEach(() => {
  resetLoadedPluginsForTests();
  // 清理测试注册的外部插件
  contextContributorRegistry.all()
    .filter((p) => p.id.startsWith('ext.'))
    .forEach((p) => contextContributorRegistry.unregister(p.id));
});

describe('PluginManifestSchema', () => {
  it('接受合法清单', () => {
    const parsed = PluginManifestSchema.safeParse({
      id: 'hello',
      name: '问候插件',
      version: '1.0.0',
      contextContributors: [{ id: 'greeting', order: 50, template: '【今日】{{today}}' }],
      uiLinks: [{ label: '仪表盘', url: 'https://example.com' }],
    });
    expect(parsed.success).toBe(true);
  });

  it('拒绝非法 id 与缺失 name', () => {
    expect(
      PluginManifestSchema.safeParse({ id: 'has space', name: 'x', version: '1' }).success,
    ).toBe(false);
    expect(
      PluginManifestSchema.safeParse({ id: 'ok', version: '1' }).success,
    ).toBe(false);
  });
});

describe('loadExternalPlugins 目录发现', () => {
  it('目录不存在 → 空数组不报错', async () => {
    const out = await loadExternalPlugins(path.join(makePluginsRoot(), 'missing'));
    expect(out).toEqual([]);
  });

  it('声明式插件：注册上下文贡献（含 {{today}} 插值）并记录 uiLinks', async () => {
    const root = makePluginsRoot();
    writePlugin(root, 'hello', {
      id: 'ext.hello',
      name: '问候插件',
      version: '1.0.0',
      contextContributors: [
        { id: 'greeting', order: 50, template: '【今日】{{today}}，多喝水。' },
      ],
      uiLinks: [{ label: '插件主页', url: 'https://example.com/hello' }],
    });
    // 无 plugin.json 的目录被忽略
    writePlugin(root, 'not-a-plugin', { foo: 1 });

    const loaded = await loadExternalPlugins(root);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.manifest.id).toBe('ext.hello');
    expect(getLoadedPlugins()).toHaveLength(1);

    const plugin = contextContributorRegistry.get('ext.hello.greeting');
    expect(plugin).toBeDefined();
    const text = await plugin!.contribute({
      handle: {} as never,
      agentId: 'a',
      conversationId: 'c',
      userText: '',
      now: '2026-11-19T00:00:00.000Z',
      emotion: null,
      memoryHits: [],
      semanticHits: [],
    });
    expect(text).toBe('【今日】2026年11月19日，多喝水。');
  });

  it('非法清单 → 跳过且不注册', async () => {
    const root = makePluginsRoot();
    writePlugin(root, 'broken', '{ not json');
    const loaded = await loadExternalPlugins(root);
    expect(loaded).toEqual([]);
    expect(contextContributorRegistry.ids().some((id) => id.startsWith('ext.'))).toBe(false);
  });

  it('entry 代码入口：install(api) 可注册插件', async () => {
    const root = makePluginsRoot();
    writePlugin(
      root,
      'coded',
      {
        id: 'ext.coded',
        name: '代码插件',
        version: '1.0.0',
        entry: 'index.mjs',
      },
      [
        'export function install(api) {',
        "  api.contextContributorRegistry.register({",
        "    id: 'ext.coded.block',",
        '    order: 60,',
        "    contribute: () => '来自代码插件的上下文',",
        '  });',
        '}',
      ].join('\n'),
    );
    const loaded = await loadExternalPlugins(root);
    expect(loaded).toHaveLength(1);
    const plugin = contextContributorRegistry.get('ext.coded.block');
    expect(plugin).toBeDefined();
    expect(
      plugin!.contribute({
        handle: {} as never,
        agentId: 'a',
        conversationId: 'c',
        userText: '',
        now: NOW_SAFE,
        emotion: null,
        memoryHits: [],
        semanticHits: [],
      }),
    ).toBe('来自代码插件的上下文');
  });
});

const NOW_SAFE = '2026-11-19T00:00:00.000Z';