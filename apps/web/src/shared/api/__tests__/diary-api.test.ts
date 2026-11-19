import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiaryEntryDTOSchema, DiaryListResponseSchema } from '@aiko/shared';
import { deleteDiary, fetchDiary } from '../diary-api';

const entry = DiaryEntryDTOSchema.parse({
  id: 'diary_1',
  agentId: 'agent-default',
  date: '2026-11-18',
  type: 'daily',
  content: '昨天我们聊了做饭，我很好奇味道。',
  mood: { valence: 0.4, arousal: 0.2, dominance: 0 },
  source: 'auto',
  createdAt: '2026-11-19T08:00:00.000Z',
  updatedAt: '2026-11-19T08:00:00.000Z',
});

const listBody = DiaryListResponseSchema.parse({ items: [entry], total: 1 });

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('diary-api domain functions', () => {
  it('fetches diary with type filter and paging', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(listBody));
    vi.stubGlobal('fetch', fetchMock);
    const data = await fetchDiary({ type: 'daily', limit: 30, offset: 0 });
    expect(data.items).toHaveLength(1);
    expect(data.items[0]?.mood?.valence).toBeCloseTo(0.4);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/diary?type=daily&limit=30&offset=0',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('omits empty query params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(listBody));
    vi.stubGlobal('fetch', fetchMock);
    await fetchDiary();
    expect(fetchMock).toHaveBeenCalledWith('/api/diary', expect.anything());
  });

  it('deletes via DELETE with encoded id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ ok: true, deletedAt: '2026-11-19T09:00:00.000Z' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await deleteDiary('diary_1');
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/diary/diary_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('throws ApiClientError on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 'DIARY_NOT_FOUND', message: 'x' }, 404)));
    await expect(fetchDiary()).rejects.toMatchObject({ code: 'DIARY_NOT_FOUND', status: 404 });
  });
});