import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, type DbHandle } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { seedDefaultData } from '../../db/seed';
import {
  getSettingsResponse,
  readAppSettings,
  resolveEffectiveLlmSettings,
  SettingsValidationError,
  updateSettings,
} from '../service';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle');
const NOW = '2026-11-12T00:00:00.000Z';

let handle: DbHandle;

beforeAll(() => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'aiko-settings-')), 'agent.sqlite');
  handle = createDb(dbPath);
  runMigrations(handle, migrationsFolder);
  seedDefaultData(handle, NOW);
  vi.stubEnv('LLM_API_KEY', '');
  vi.stubEnv('LLM_BASE_URL', '');
  vi.stubEnv('LLM_MODEL', '');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('settings service', () => {
  it('reads seeded defaults', () => {
    const settings = readAppSettings(handle);
    expect(settings.theme).toBe('system');
    expect(settings.recentWindowRounds).toBe(15);
    expect(settings.maxContextMessages).toBe(30);
    expect(settings.defaultAgentId).toBeTruthy();
  });

  it('resolves effective llm settings with fallback chain (db > env > default)', () => {
    expect(resolveEffectiveLlmSettings(handle)).toEqual({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: null,
    });

    updateSettings(handle, {
      llmBaseUrl: 'https://relay.example.com/v1',
      llmModel: 'relay-model',
      llmApiKey: 'sk-abcd1234',
    }, NOW);

    const effective = resolveEffectiveLlmSettings(handle);
    expect(effective.baseUrl).toBe('https://relay.example.com/v1');
    expect(effective.model).toBe('relay-model');
    expect(effective.apiKey).toBe('sk-abcd1234');
  });

  it('masks api key in connection info and never echoes the full key', () => {
    const response = getSettingsResponse(handle);
    expect(response.llm.apiKeyConfigured).toBe(true);
    expect(response.llm.apiKeyHint).toBe('****1234');
    expect(JSON.stringify(response)).not.toContain('sk-abcd1234');
  });

  it('null clears the stored api key', () => {
    updateSettings(handle, { llmApiKey: null }, NOW);
    const response = getSettingsResponse(handle);
    expect(response.llm.apiKeyConfigured).toBe(false);
    expect(response.llm.apiKeyHint).toBeNull();
  });

  it('derives maxContextMessages from recentWindowRounds', () => {
    const response = updateSettings(handle, { recentWindowRounds: 10 }, NOW);
    expect(response.settings.recentWindowRounds).toBe(10);
    expect(response.settings.maxContextMessages).toBe(20);
  });

  it('derives recentWindowRounds from even maxContextMessages', () => {
    const response = updateSettings(handle, { maxContextMessages: 26 }, NOW);
    expect(response.settings.recentWindowRounds).toBe(13);
    expect(response.settings.maxContextMessages).toBe(26);
  });

  it('rejects odd maxContextMessages derive', () => {
    expect(() => updateSettings(handle, { maxContextMessages: 25 }, NOW)).toThrow(
      SettingsValidationError,
    );
  });

  it('persists theme updates', () => {
    const response = updateSettings(handle, { theme: 'dark' }, NOW);
    expect(response.settings.theme).toBe('dark');
    expect(readAppSettings(handle).theme).toBe('dark');
  });
});