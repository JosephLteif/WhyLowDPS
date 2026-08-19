import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LanSessionLifecycle from './LanSessionLifecycle';

describe('LanSessionLifecycle', () => {
  const originalSendBeacon = navigator.sendBeacon;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: vi.fn().mockReturnValue(true),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: originalSendBeacon,
    });
  });

  it('keeps a visible LAN session present and disconnects it when hidden', () => {
    render(<LanSessionLifecycle />);
    const fetchMock = vi.mocked(fetch);
    const sendBeacon = vi.mocked(navigator.sendBeacon);

    expect(fetchMock).toHaveBeenCalledWith('/api/lan/presence', {
      credentials: 'include',
      cache: 'no-store',
    });

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(sendBeacon).toHaveBeenCalledWith('/api/lan/disconnect');
  });

  it('announces a revoked session when presence returns 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('LAN pairing required', { status: 401 })));
    const revoked = vi.fn();
    window.addEventListener('whylowdps-lan-access-revoked', revoked);

    render(<LanSessionLifecycle />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(revoked).toHaveBeenCalledOnce();
    window.removeEventListener('whylowdps-lan-access-revoked', revoked);
  });
});
