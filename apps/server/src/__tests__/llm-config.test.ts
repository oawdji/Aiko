import { describe, expect, it } from 'vitest';
import { loadLlmConfig } from '../config/llm';

const validEnv = {
  LLM_API_KEY: 'sk-test',
  LLM_BASE_URL: 'https://api.deepseek.com',
  LLM_MODEL: 'deepseek-chat',
};

describe('loadLlmConfig', () => {
  it('parses and trims a valid config', () => {
    const config = loadLlmConfig({
      LLM_API_KEY: '  sk-test  ',
      LLM_BASE_URL: ' https://api.deepseek.com ',
      LLM_MODEL: ' deepseek-chat ',
    });
    expect(config).toEqual({
      apiKey: 'sk-test',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    });
  });

  it('fails fast with a clear message when the key is missing', () => {
    expect(() =>
      loadLlmConfig({ ...validEnv, LLM_API_KEY: undefined }),
    ).toThrow(/LLM_API_KEY/);
  });

  it('rejects an invalid base URL', () => {
    expect(() =>
      loadLlmConfig({ ...validEnv, LLM_BASE_URL: 'not-a-url' }),
    ).toThrow(/LLM_BASE_URL/);
  });

  it('rejects an empty model', () => {
    expect(() => loadLlmConfig({ ...validEnv, LLM_MODEL: '' })).toThrow(
      /LLM_MODEL/,
    );
  });
});