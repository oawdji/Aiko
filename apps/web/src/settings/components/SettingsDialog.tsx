import { useEffect, useState } from 'react';
import type { LlmConnectionTestResponse, SettingsResponse } from '@aiko/shared';
import { ApiClientError } from '../../shared/api/errors';
import {
  testLlmConnection,
  updateSettings,
} from '../../shared/api/settings-api';

type Props = {
  open: boolean;
  settings: SettingsResponse | null;
  onSaved: (response: SettingsResponse) => void;
  onClose: () => void;
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

  useEffect(() => {
    if (open && settings) {
      setBaseUrl(settings.llm.baseUrl);
      setModel(settings.llm.model);
      setApiKey('');
      setNotice(null);
      setErrorText(null);
      setTestResult(null);
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

  return (
    <div
      aria-label="LLM 设置"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-neutral-100"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">LLM 设置</h2>
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

        <div className="flex justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || saving}
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
          >
            {testing ? '测试中…' : '测试连接'}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-neutral-400 hover:bg-neutral-800"
            >
              关闭
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || testing}
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-sky-400 disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}