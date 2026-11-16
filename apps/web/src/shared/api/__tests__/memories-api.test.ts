import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryFactDTOSchema, MemoryListResponseSchema } from '@aiko/shared';
import {
  confirmMemory,
  deleteMemory,
  fetchMemories,
  patchMemory,
  rejectMemory,
} from '../memories-api';

const fact = MemoryFactDTOSchema.parse({
  id: 'mem_1',
  userId: 'local-user',
  agentId: 'agent-default',
  type: 'fact',
  content: '用户正在学做饭',
  sourceMessageId: 'msg_1',
  confidence: 0.9,
  status: 'active',
  memoryPad: { v: 0, a: 0, d: 0 },
  arousal: 0,
  halfLifeHours: 72,
  strength: 1,
  lastAccessedAt: null,
  createdAt: '2026-11-13T00:00:00.000Z',
  updatedAt: '2026-11-13T00:00:00.000Z',
});

const listBody = MemoryListResponseSchema.parse({ memories: [fact] });

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('memories-api domain functions', () => {
  it('fetches memories with query params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(listBody));
    vi.stubGlobal('fetch', fetchMock);
    const data = await fetchMemories({ status: 'active', type: 'fact', limit: 50 });
    expect(data).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/memories?status=active&type=fact&limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('patches content via PATCH with JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fact));
    vi.stubGlobal('fetch', fetchMock);
    await patchMemory('mem_1', { content: '用户在学川菜' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/memories/mem_1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ content: '用户在学川菜' }),
      }),
    );
  });

  it('delete/confirm/reject use the right methods and paths', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(fact)));
    vi.stubGlobal('fetch', fetchMock);
    await deleteMemory('mem_1');
    await confirmMemory('mem_1');
    await rejectMemory('mem_1');
    const calls = fetchMock.mock.calls.map(
      ([path, init]) => [path, (init as RequestInit).method] as const,
    );
    expect(calls).toEqual([
      ['/api/memories/mem_1', 'DELETE'],
      ['/api/memories/mem_1/confirm', 'POST'],
      ['/api/memories/mem_1/reject', 'POST'],
    ]);
  });

  it('throws ApiClientError on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 'MEM_NOT_FOUND', message: 'x' }, 404)));
    await expect(fetchMemories()).rejects.toMatchObject({ code: 'MEM_NOT_FOUND', status: 404 });
  });
});
