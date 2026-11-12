import {
  createOpenAICompatible,
  type OpenAICompatibleProvider,
} from '@ai-sdk/openai-compatible';
import type { LlmConfig } from '../config/llm';

type LlmInstance = {
  provider: OpenAICompatibleProvider;
  config: LlmConfig;
};

let cache: { key: string; instance: LlmInstance } | null = null;

/**
 * OpenAI 兼容 Provider（按配置键缓存）。
 * DeepSeek、第三方中转站、本地 vLLM/Ollama 等端点都通过
 * baseUrl + model 切换，不引入 provider 特定逻辑。
 * 配置变化（设置页保存）后自动重建实例，热生效、无需重启。
 */
export function getLlm(config: LlmConfig): LlmInstance {
  const key = `${config.baseUrl}|${config.model}|${config.apiKey}`;
  if (!cache || cache.key !== key) {
    const provider = createOpenAICompatible({
      name: 'llm',
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
    });
    cache = { key, instance: { provider, config } };
  }
  return cache.instance;
}

export function getChatModel(config: LlmConfig) {
  const { provider } = getLlm(config);
  return provider.chatModel(config.model);
}