import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsResponseSchema } from '@aiko/shared';
import { fetchSettings, testLlmConnection, updateSettings } from '../settings-api';

const okSettings = SettingsResponseSchema.parse({
  settings: {
    defaultAgentId: 'agent-default',
    recentWindowRounds: 15,
    maxContextMessages: 30,
    theme: 'dark',
  },
  llm: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    apiKeyConfigured: true,
    apiKeyHint: '****1234',
  },
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('settings-api domain functions', () => {
  it('fetches settings via GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(okSettings));
    vi.stubGlobal('fetch', fetchMock);

    const data = await fetchSettings();
    expect(data.llm.apiKeyHint).toBe('****1234');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/settings',
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json' },
      }),
    );
  });

  it('patches settings with JSON body and Content-Type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(okSettings));
    vi.stubGlobal('fetch', fetchMock);

    await updateSettings({ llmApiKey: 'sk-new', theme: 'dark' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/settings',
      expect.objectContaining({
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ llmApiKey: 'sk-new', theme: 'dark' }),
      }),
    );
  });

  it('posts llm connection test', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, latencyMs: 120, errorCode: null }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await testLlmConnection();
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/settings/llm/test',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws ApiClientError with server code on error responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ code: 'INVALID_REQUEST', message: 'Validation failed' }, 400),
      ),
    );

    await expect(updateSettings({ maxContextMessages: 25 })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      status: 400,
    });
  });
});