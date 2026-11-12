import { eq } from 'drizzle-orm';
import { generateText } from 'ai';
import {
  LlmConnectionInfoSchema,
  SettingsResponseSchema,
  type LlmConnectionInfo,
  type LlmConnectionTestResponse,
  type SettingsResponse,
  type UpdateSettingsRequestBody,
} from '@aiko/shared';
import {
  LLM_DEFAULT_BASE_URL,
  LLM_DEFAULT_MODEL,
  type LlmConfig,
} from '../config/llm';
import type { DbHandle } from '../db/client';
import { appSettings } from '../db/schema';
import { getChatModel } from '../llm/provider';

/** §12.4 推导规则失败（maxContextMessages 为奇数等）时抛出，route 映射 400。 */
export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsValidationError';
  }
}

const THEME_KEY = 'theme';
const RECENT_WINDOW_ROUNDS_KEY = 'recent_window_rounds';
const MAX_CONTEXT_MESSAGES_KEY = 'max_context_messages';
const LLM_BASE_URL_KEY = 'llm_base_url';
const LLM_MODEL_KEY = 'llm_model';
const LLM_API_KEY_KEY = 'llm_api_key';

function readSettingValue(handle: DbHandle, key: string): unknown {
  const row = handle.db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .get();
  return row ? JSON.parse(row.valueJson) : undefined;
}

function writeSettingValue(handle: DbHandle, key: string, value: unknown, now: string): void {
  const valueJson = JSON.stringify(value);
  const existing = handle.db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .get();
  if (existing) {
    handle.db
      .update(appSettings)
      .set({ valueJson, updatedAt: now })
      .where(eq(appSettings.key, key))
      .run();
  } else {
    handle.db.insert(appSettings).values({ key, valueJson, updatedAt: now }).run();
  }
}

function clearSettingValue(handle: DbHandle, key: string): void {
  handle.db.delete(appSettings).where(eq(appSettings.key, key)).run();
}

/** 从 app_settings 键值表读取并组装 AppSettings（seed 保证键存在）。 */
export function readAppSettings(handle: DbHandle) {
  const rows = handle.db.select().from(appSettings).all();
  const values = new Map(rows.map((row) => [row.key, JSON.parse(row.valueJson)]));

  return SettingsResponseSchema.shape.settings.parse({
    defaultAgentId: values.get('default_agent_id'),
    recentWindowRounds: values.get('recent_window_rounds'),
    maxContextMessages: values.get('max_context_messages'),
    theme: values.get('theme'),
  });
}

export type EffectiveLlmSettings = {
  baseUrl: string;
  model: string;
  apiKey: string | null;
};

/**
 * 生效 LLM 配置：app_settings 覆盖 > 环境变量 > DeepSeek 默认值。
 * Key 只写不读（api-contract.md §12.6），任何响应不得回显完整 Key。
 */
export function resolveEffectiveLlmSettings(handle: DbHandle): EffectiveLlmSettings {
  const dbBaseUrl = readSettingValue(handle, LLM_BASE_URL_KEY);
  const dbModel = readSettingValue(handle, LLM_MODEL_KEY);
  const dbApiKey = readSettingValue(handle, LLM_API_KEY_KEY);
  const envApiKey = process.env.LLM_API_KEY?.trim();

  return {
    baseUrl:
      (typeof dbBaseUrl === 'string' && dbBaseUrl) ||
      process.env.LLM_BASE_URL?.trim() ||
      LLM_DEFAULT_BASE_URL,
    model:
      (typeof dbModel === 'string' && dbModel) ||
      process.env.LLM_MODEL?.trim() ||
      LLM_DEFAULT_MODEL,
    apiKey:
      (typeof dbApiKey === 'string' && dbApiKey) ||
      (envApiKey ? envApiKey : null),
  };
}

function toConnectionInfo(settings: EffectiveLlmSettings): LlmConnectionInfo {
  const configured = typeof settings.apiKey === 'string' && settings.apiKey.length > 0;
  return LlmConnectionInfoSchema.parse({
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKeyConfigured: configured,
    apiKeyHint: configured ? '****' + settings.apiKey!.slice(-4) : null,
  });
}

export function getSettingsResponse(handle: DbHandle): SettingsResponse {
  return SettingsResponseSchema.parse({
    settings: readAppSettings(handle),
    llm: toConnectionInfo(resolveEffectiveLlmSettings(handle)),
  });
}

/**
 * PATCH /api/settings（§12）：只更新传入字段；
 * rounds/maxContext 满足 §12.4 推导规则（单传一个自动推导）。
 */
export function updateSettings(
  handle: DbHandle,
  body: UpdateSettingsRequestBody,
  now: string,
): SettingsResponse {
  if (body.theme !== undefined) {
    writeSettingValue(handle, THEME_KEY, body.theme, now);
  }

  let rounds = body.recentWindowRounds;
  let maxContext = body.maxContextMessages;
  if (rounds !== undefined && maxContext === undefined) {
    maxContext = rounds * 2;
  }
  if (maxContext !== undefined && rounds === undefined) {
    if (maxContext % 2 !== 0) {
      throw new SettingsValidationError(
        'maxContextMessages must be even to derive recentWindowRounds',
      );
    }
    rounds = maxContext / 2;
  }
  if (rounds !== undefined) {
    writeSettingValue(handle, RECENT_WINDOW_ROUNDS_KEY, rounds, now);
  }
  if (maxContext !== undefined) {
    writeSettingValue(handle, MAX_CONTEXT_MESSAGES_KEY, maxContext, now);
  }

  if (body.llmBaseUrl !== undefined) {
    writeSettingValue(handle, LLM_BASE_URL_KEY, body.llmBaseUrl, now);
  }
  if (body.llmModel !== undefined) {
    writeSettingValue(handle, LLM_MODEL_KEY, body.llmModel, now);
  }
  if (body.llmApiKey !== undefined) {
    if (body.llmApiKey === null) {
      clearSettingValue(handle, LLM_API_KEY_KEY);
    } else {
      writeSettingValue(handle, LLM_API_KEY_KEY, body.llmApiKey, now);
    }
  }

  return getSettingsResponse(handle);
}

/** §12.6 连接测试：一次最小真实调用，不改变现有配置，失败不回显 Key。 */
export async function testLlmConnection(handle: DbHandle): Promise<LlmConnectionTestResponse> {
  const settings = resolveEffectiveLlmSettings(handle);
  if (!settings.apiKey) {
    return { ok: false, latencyMs: 0, errorCode: 'LLM_REQUEST_FAILED' };
  }
  const config: LlmConfig = {
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: settings.apiKey,
  };
  const start = Date.now();
  try {
    await generateText({
      model: getChatModel(config),
      system: 'You are a connection probe. Reply with exactly: ok',
      prompt: 'ping',
    });
    return { ok: true, latencyMs: Date.now() - start, errorCode: null };
  } catch {
    return { ok: false, latencyMs: Date.now() - start, errorCode: 'LLM_REQUEST_FAILED' };
  }
}