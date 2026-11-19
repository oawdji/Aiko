import { useEffect, useState } from 'react';
import type {
  LlmConnectionTestResponse,
  PluginInfo,
  ProactiveSettings,
  SettingsResponse,
} from '@aiko/shared';
import { ApiClientError } from '../../shared/api/errors';
import { fetchProactiveHistory } from '../../proactive/api/proactive-api';
import {
  fetchSettings,
  testLlmConnection,
  updateSettings,
} from '../../shared/api/settings-api';
import { fetchPlugins, updatePlugin } from '../../shared/api/plugins-api';

type Props = {
  open: boolean;
  settings: SettingsResponse | null;
  onSaved: (response: SettingsResponse) => void;
  onClose: () => void;
};

const MOUNT_POINT_LABEL: Record<string, string> = {
  'context-contributor': '上下文注入',
  'proactive-strategy': '主动策略',
  'emotion-extractor': '情绪抽取',
  'memory-retriever': '记忆检索',
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * LLM 设置弹窗（§11/§12/§12.6）：
 * - Key 只写不读，已配置时仅展示掩码提示；
 * - 保存立即生效，无需重启服务；
 * - 「测试连接」发起一次真实最小调用。
 */
export function SettingsDialog({ open, settings, onSaved, onClose }: Props) {
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<LlmConnectionTestResponse | null>(null);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [proactive, setProactive] = useState<ProactiveSettings>({
    enabled: false,
    idleMinutes: 30,
    maxPer24h: 3,
    quietStart: '22:00',
    quietEnd: '08:00',
    minIntervalMinutes: 60,
  });
  const [proactiveHistory, setProactiveHistory] = useState<
    Array<{ id: string; strategy: string; evidenceText: string; createdAt: string; content: string }>
  >([]);

  // 打开弹窗时拉取最新设置：语义检索可能刚在对话中降级/恢复，props 里的快照是旧的
  useEffect(() => {
    if (!open) return;
    fetchSettings()
      .then(onSaved)
      .catch(() => undefined);
    fetchPlugins()
      .then((r) => setPlugins(r.plugins))
      .catch(() => setPlugins([]));
    // （依赖仅 open：设置刷新由 onSaved 回写 props）
  }, [open]);

  useEffect(() => {
    if (open && settings) {
      setBaseUrl(settings.llm.baseUrl);
      setModel(settings.llm.model);
      setApiKey('');
      setProactive(settings.settings.proactive);
      setNotice(null);
      setErrorText(null);
      setTestResult(null);
      fetchProactiveHistory()
        .then((r) => setProactiveHistory(r.messages.slice(0, 10)))
        .catch(() => setProactiveHistory([]));
    }
  }, [open, settings]);

  if (!open) {
    return null;
  }

  const handleSave = async () => {
    setSaving(true);
    setErrorText(null);
    setNotice(null);
    try {
      const saved = await updateSettings({
        llmBaseUrl: baseUrl || undefined,
        llmModel: model || undefined,
        llmApiKey: apiKey ? apiKey : undefined,
        proactive: {
          enabled: proactive.enabled,
          idleMinutes: Number(proactive.idleMinutes),
          maxPer24h: Number(proactive.maxPer24h),
          quietStart: proactive.quietStart,
          quietEnd: proactive.quietEnd,
          minIntervalMinutes: Number(proactive.minIntervalMinutes),
        },
      });
      onSaved(saved);
      setApiKey('');
      setNotice('已保存，立即生效');
    } catch (error) {
      setErrorText(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setErrorText(null);
    setTestResult(null);
    try {
      setTestResult(await testLlmConnection());
    } catch (error) {
      setErrorText(errorMessage(error));
    } finally {
      setTesting(false);
    }
  };

  const handleTogglePlugin = (id: string, enabled: boolean) => {
    setPlugins((list) => list.map((p) => (p.id === id ? { ...p, enabled } : p)));
    updatePlugin(id, enabled)
      .then((r) => setPlugins(r.plugins))
      .catch(() => {
        setPlugins((list) => list.map((p) => (p.id === id ? { ...p, enabled: !enabled } : p)));
        setErrorText('插件状态保存失败');
      });
  };

  return (
    <div
      aria-label="LLM 设置"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="llm-settings-title"
        className="max-h-[92dvh] w-full space-y-4 overflow-y-auto rounded-t-2xl border border-neutral-800 bg-neutral-900 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-neutral-100 sm:max-w-md sm:rounded-xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="llm-settings-title" className="text-lg font-semibold">
            LLM 设置
          </h2>
          <button
            type="button"
            aria-label="关闭设置"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-neutral-500">
          兼容 OpenAI 格式的端点（DeepSeek、第三方中转、本地 vLLM/Ollama）。
          API Key 只写不读，保存后立即生效。
        </p>

        {settings?.memory && (
          <section aria-label="记忆检索" className="space-y-1 rounded-lg border border-neutral-800 p-3">
            <h3 className="text-sm font-semibold text-neutral-300">记忆检索</h3>
            {settings.memory.state === 'ok' && (
              <p className="text-xs text-emerald-400">
                语义向量检索可用（bge-base-zh）——历史对话按语义召回注入上下文。
              </p>
            )}
            {settings.memory.state === 'degraded' && (
              <p className="text-xs text-amber-400">
                已降级为 FTS5 关键词检索（语义服务不可用）
                {settings.memory.reason && (
                  <span className="text-neutral-500">：{settings.memory.reason}</span>
                )}
                <span className="block text-neutral-500">
                  聊天不受影响；如需恢复语义检索，请检查 PYTHON_EXECUTABLE 与 embedding 模型配置后重启服务。
                </span>
              </p>
            )}
            {settings.memory.state === 'unverified' && (
              <p className="text-xs text-neutral-500">
                尚未验证——完成一轮对话后自动确认。未安装 Python 语义服务时自动降级为 FTS5 关键词检索。
              </p>
            )}
          </section>
        )}

        {plugins.length > 0 && (
          <section aria-label="插件" className="space-y-2 rounded-lg border border-neutral-800 p-3">
            <h3 className="text-sm font-semibold text-neutral-300">插件</h3>
            <p className="text-[10px] text-neutral-600">禁用即时生效（禁用后对应功能块不再注入，聊天不受影响）。</p>
            <ul className="space-y-1.5">
              {plugins.map((plugin) => (
                <li key={plugin.id} className="flex items-start justify-between gap-2 rounded bg-neutral-950/60 px-2 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs text-neutral-200">{plugin.id}</p>
                    {plugin.description && (
                      <p className="truncate text-[10px] text-neutral-500">{plugin.description}</p>
                    )}
                    <p className="text-[10px] text-neutral-600">
                      {MOUNT_POINT_LABEL[plugin.mountPoint] ?? plugin.mountPoint}
                    </p>
                  </div>
                  <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[10px] text-neutral-400">
                    <input
                      type="checkbox"
                      checked={plugin.enabled}
                      onChange={(e) => handleTogglePlugin(plugin.id, e.target.checked)}
                      className="accent-sky-500"
                    />
                    {plugin.enabled ? '启用' : '禁用'}
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-label="主动行为" className="space-y-3 rounded-lg border border-neutral-800 p-3">
          <h3 className="text-sm font-semibold text-neutral-300">主动行为</h3>
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={proactive.enabled}
              onChange={(e) => setProactive({ ...proactive, enabled: e.target.checked })}
              className="size-4 accent-sky-500"
            />
            允许她在空闲时主动发消息（仅页面打开期间）
          </label>
          <div className="grid grid-cols-2 gap-2 text-xs text-neutral-400">
            <label className="space-y-1">
              <span>空闲阈值（分钟）</span>
              <input
                type="number"
                min={1}
                max={1440}
                value={proactive.idleMinutes}
                onChange={(e) => setProactive({ ...proactive, idleMinutes: Number(e.target.value) })}
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
              />
            </label>
            <label className="space-y-1">
              <span>24 小时上限（次）</span>
              <input
                type="number"
                min={1}
                max={50}
                value={proactive.maxPer24h}
                onChange={(e) => setProactive({ ...proactive, maxPer24h: Number(e.target.value) })}
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
              />
            </label>
            <label className="space-y-1">
              <span>免打扰开始</span>
              <input
                value={proactive.quietStart}
                onChange={(e) => setProactive({ ...proactive, quietStart: e.target.value })}
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
              />
            </label>
            <label className="space-y-1">
              <span>免打扰结束</span>
              <input
                value={proactive.quietEnd}
                onChange={(e) => setProactive({ ...proactive, quietEnd: e.target.value })}
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
              />
            </label>
            <label className="space-y-1">
              <span>最小间隔（分钟）</span>
              <input
                type="number"
                min={0}
                max={1440}
                value={proactive.minIntervalMinutes}
                onChange={(e) => setProactive({ ...proactive, minIntervalMinutes: Number(e.target.value) })}
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
              />
            </label>
          </div>
          {proactiveHistory.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs text-neutral-500">
                主动消息历史（最近 {proactiveHistory.length} 条）
              </summary>
              <ul className="mt-1.5 space-y-1.5">
                {proactiveHistory.map((m) => (
                  <li key={m.id} className="rounded bg-neutral-950/60 px-2 py-1.5 text-xs">
                    <span className="text-neutral-500">
                      {new Date(m.createdAt).toLocaleString()} · {m.strategy}
                    </span>
                    <p className="text-neutral-300">{m.content}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-[10px] text-neutral-600">
            免打扰支持跨午夜（如 22:00–08:00）；被抑制的消息不会补发；刷新或关闭页面即停止主动行为。
          </p>
        </section>

        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-sm text-neutral-400">Base URL</span>
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.deepseek.com"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-sky-500"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-neutral-400">模型</span>
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="deepseek-chat"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-sky-500"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-neutral-400">
              API Key
              {settings?.llm.apiKeyConfigured && (
                <span className="ml-2 text-emerald-400">
                  已配置（{settings.llm.apiKeyHint}）
                </span>
              )}
            </span>
            <input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              type="password"
              placeholder={settings?.llm.apiKeyConfigured ? '留空保持现有 Key 不变' : 'sk-...'}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-sky-500"
            />
          </label>
        </div>

        {notice && <p className="text-xs text-emerald-400">{notice}</p>}
        {errorText && <p className="text-xs text-red-400">{errorText}</p>}
        {testResult && (
          <p className={testResult.ok ? 'text-xs text-emerald-400' : 'text-xs text-red-400'}>
            {testResult.ok
              ? `连接成功（${testResult.latencyMs}ms）`
              : `连接失败：${testResult.errorCode ?? '未知错误'}`}
          </p>
        )}

        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || saving}
            className="rounded-lg border border-neutral-700 px-4 py-2.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50 sm:py-2"
          >
            {testing ? '测试中…' : '测试连接'}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg px-4 py-2.5 text-sm text-neutral-400 hover:bg-neutral-800 sm:flex-none sm:py-2"
            >
              关闭
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || testing}
              className="flex-1 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-neutral-950 hover:bg-sky-400 disabled:opacity-50 sm:flex-none sm:py-2"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}