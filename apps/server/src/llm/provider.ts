import {
  createOpenAICompatible,
  type OpenAICompatibleProvider,
} from '@ai-sdk/openai-compatible';
import { loadLlmConfig, type LlmConfig } from '../config/llm';

type LlmInstance = {
  provider: OpenAICompatibleProvider;
  config: LlmConfig;
};

let instance: LlmInstance | null = null;

/**
 * OpenAI 兼容 Provider 单例。
 * DeepSeek、第三方中转站、本地 vLLM/Ollama 等端点都通过
 * LLM_BASE_URL + LLM_MODEL 切换，不引入 provider 特定逻辑。
 */
export function getLlm(): LlmInstance {
  if (!instance) {
    const config = loadLlmConfig();
    const provider = createOpenAICompatible({
      name: 'llm',
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
    });
    instance = { provider, config };
  }
  return instance;
}

export function getChatModel() {
  const { provider, config } = getLlm();
  return provider.chatModel(config.model);
}