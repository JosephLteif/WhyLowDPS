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
});
