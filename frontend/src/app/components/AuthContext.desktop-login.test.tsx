import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  invoke: vi.fn(),
  randomUUID: vi.fn(),
  saveBlizzardCredentialProfile: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  API_URL: 'http://localhost:17384',
  fetchJson: mocks.fetchJson,
  isDesktop: true,
  isNetworkUnavailableError: vi.fn(() => false),
  saveBlizzardCredentialProfile: mocks.saveBlizzardCredentialProfile,
  setSessionToken: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe('AuthContext desktop login', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    mocks.fetchJson.mockRejectedValue(new Error('unauthorized'));
    mocks.invoke.mockReturnValue(new Promise(() => {}));
    mocks.saveBlizzardCredentialProfile.mockResolvedValue({ id: 'saved-profile-123' });
    mocks.randomUUID.mockReturnValue('flow-123');
    vi.stubGlobal('fetch', vi.fn());
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { ...globalThis.crypto, randomUUID: mocks.randomUUID },
    });
  });

  it('does not wait for the desktop auth window command to resolve', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    const loginPromise = result.current.login('client-id', 'client-secret');
    const outcome = await Promise.race([
      loginPromise.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 50)),
    ]);

    expect(outcome).toBe('resolved');
    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('open_auth_window', {
        url: 'http://localhost:17384/api/auth/bnet/login?flow_id=flow-123&credential_id=saved-profile-123',
      });
    });
    expect(mocks.saveBlizzardCredentialProfile).toHaveBeenCalledWith({
      name: 'Login credentials',
      client_id: 'client-id',
      client_secret: 'client-secret',
    });
  });

  it('passes saved credential profile id to desktop auth login', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.login(undefined, undefined, 'profile-123');

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('open_auth_window', {
        url: 'http://localhost:17384/api/auth/bnet/login?flow_id=flow-123&credential_id=profile-123',
      });
    });
  });
});
