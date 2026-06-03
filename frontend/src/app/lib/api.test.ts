import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchJson, fetchJsonCached, isNetworkUnavailableError, TOKEN_KEY } from './api';

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

describe('api helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds auth, default JSON content type, and credentials to mutating requests', async () => {
    localStorage.setItem(TOKEN_KEY, 'token-123');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchJson('/api/test', { method: 'POST', body: JSON.stringify({ a: 1 }) })
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe('include');
    expect(init.headers.Authorization).toBe('Bearer token-123');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('returns undefined for empty successful responses and surfaces server detail errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 200 })));
    await expect(fetchJson('/api/empty')).resolves.toBeUndefined();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ detail: 'Bad input' }, { status: 400 })));
    await expect(fetchJson('/api/bad')).rejects.toMatchObject({
      message: 'Bad input',
      status: 400,
      detail: 'Bad input',
    });
  });

  it('marks missing backend errors as network-unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(fetchJson('/api/offline')).rejects.toMatchObject({
      message: 'Backend not reachable',
      status: 0,
      code: 'NETWORK_UNAVAILABLE',
    });
    expect(isNetworkUnavailableError({ status: 0 })).toBe(true);
    expect(isNetworkUnavailableError({ name: 'AbortError' })).toBe(true);
    expect(isNetworkUnavailableError({ status: 500 })).toBe(false);
  });

  it('dedupes cached GET requests and uses persistent cache when fresh', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ value: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    const first = fetchJsonCached('/api/cache', { ttl: 1000, usePersistentCache: true });
    const second = fetchJsonCached('/api/cache', { ttl: 1000, usePersistentCache: true });
    await expect(Promise.all([first, second])).resolves.toEqual([{ value: 1 }, { value: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(
      fetchJsonCached('/api/cache', { ttl: 1000, usePersistentCache: true })
    ).resolves.toEqual({ value: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
