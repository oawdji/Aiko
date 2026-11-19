/**
 * 插件清单（plugin.json）schema（Phase 3）。
 *
 * 插件以目录形式放置在插件根目录（默认 <repo>/plugins，可用 AIKO_PLUGINS_DIR 覆盖）：
 *   plugins/<plugin-name>/plugin.json
 * 支持两种能力：
 * 1. 声明式（无代码）：contextContributors 模板块（支持 {{today}} 插值）、uiLinks 工具链接；
 * 2. 代码入口：entry 指向 ESM 模块，default export 的 install(api) 可访问全部注册表
 *    与事件订阅（本地代码 = 本地信任，权限字段仅作声明与展示）。
 * 清单非法 / 入口加载失败的插件 → 跳过并 console.warn，绝不阻断服务启动。
 */

import { z } from 'zod';

export const PluginManifestSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, 'plugin id: letters/digits/._- only'),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  contextContributors: z
    .array(
      z.object({
        /** 相对 key，完整注册 id = `${manifest.id}.${key}` */
        id: z.string().min(1),
        order: z.number().int(),
        /** 静态模板；{{today}} 会替换为对话当天日期（zh-CN） */
        template: z.string().min(1),
      }),
    )
    .optional(),
  uiLinks: z
    .array(
      z.object({
        label: z.string().min(1),
        url: z.string().min(1),
      }),
    )
    .optional(),
  permissions: z
    .object({
      network: z.array(z.string()).default([]),
    })
    .optional(),
  entry: z.string().optional(),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export type LoadedPluginInfo = {
  manifest: PluginManifest;
  dir: string;
};