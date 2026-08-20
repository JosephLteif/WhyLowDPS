import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe('AuthContext light mode', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { status: 401 })));
  });

  it('persists light mode when enabled and clears it when disabled', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect((result.current as any).lightMode).toBe(false);

    act(() => {
      (result.current as any).enableLightMode();
    });

    expect((result.current as any).lightMode).toBe(true);
    expect(localStorage.getItem('whylowdps_light_mode')).toBe('1');

    act(() => {
      (result.current as any).disableLightMode();
    });

    expect((result.current as any).lightMode).toBe(false);
    expect(localStorage.getItem('whylowdps_light_mode')).toBeNull();
  });

  it('keeps full mode selected when the desktop guest account is returned', async () => {
    localStorage.setItem('whylowdps_light_mode', '1');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ id: 'local-guest', battletag: 'Local Guest', role: 'member', guest: true })
      )
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.lightMode).toBe(true));

    act(() => {
      result.current.disableLightMode();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lightMode).toBe(false);
    expect(localStorage.getItem('whylowdps_light_mode')).toBeNull();
    expect(localStorage.getItem('whylowdps_full_mode')).toBe('1');
  });

  it('shows the pairing scanner when the backend identifies a revoked LAN session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('LAN pairing required', { status: 401 })));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.lanAccessRequired).toBe(true));
    expect(result.current.lightMode).toBe(false);
    expect(localStorage.getItem('whylowdps_light_mode')).toBeNull();
  });

  it('reacts to a direct API 401 without requiring a refresh', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 200 }))
      .mockResolvedValue(new Response('LAN pairing required', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await fetch('/api/data/status');
    });

    await waitFor(() => expect(result.current.lanAccessRequired).toBe(true));
  });
});
