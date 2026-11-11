import { z } from 'zod';

const LlmEnvSchema = z.object({
  LLM_API_KEY: z.string().trim().min(1, 'must not be empty'),
  LLM_BASE_URL: z.string().trim().url('must be a valid URL'),
  LLM_MODEL: z.string().trim().min(1, 'must not be empty'),
});

export type LlmConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export function loadLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const result = LlmEnvSchema.safeParse({
    LLM_API_KEY: env.LLM_API_KEY,
    LLM_BASE_URL: env.LLM_BASE_URL,
    LLM_MODEL: env.LLM_MODEL,
  });

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(
      `Invalid LLM config (${issues}). Copy apps/server/.env.example to apps/server/.env and fill it in.`,
    );
  }

  return {
    apiKey: result.data.LLM_API_KEY,
    baseUrl: result.data.LLM_BASE_URL,
    model: result.data.LLM_MODEL,
  };
}