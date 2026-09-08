'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  API_URL,
  LAN_ACCESS_REQUIRED_STORAGE_KEY,
  LAN_ACCESS_REVOKED_EVENT,
  fetchJson,
  isDesktop,
  isLanBrowser,
  isNetworkUnavailableError,
  saveBlizzardCredentialProfile,
  setSessionToken,
  switchBrowserUserScope,
} from '../lib/api';
import { createUuid } from '../lib/uuid';

export type AuthUser = {
  id: string;
  battletag: string;
  role: 'admin' | 'member';
  guest: boolean;
};

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  lanAccessRequired: boolean;
  lightMode: boolean;
  enableLightMode: () => void;
  disableLightMode: () => void;
  login: (
    clientId?: string,
    clientSecret?: string,
    credentialId?: string,
    forceAccountSelection?: boolean
  ) => Promise<void>;
  logout: (switchAccount?: boolean) => void;
  checkCredentialsStatus: () => Promise<{ globally_configured: boolean }>;
  setSystemCredentials: (clientId: string, clientSecret: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  lanAccessRequired: false,
  lightMode: false,
  enableLightMode: () => {},
  disableLightMode: () => {},
  login: async () => {},
  logout: () => {},
  checkCredentialsStatus: async () => ({ globally_configured: false }),
  setSystemCredentials: async () => false,
});

let authCheckInFlight: Promise<AuthUser | null> | null = null;
const LIGHT_MODE_KEY = 'whylowdps_light_mode';
const FULL_MODE_KEY = 'whylowdps_full_mode';
const DESKTOP_SESSION_TIMEOUT_MS = 250;

function isTransientAuthError(error: unknown): boolean {
  if (isNetworkUnavailableError(error)) return true;
  const status = Number((error as { status?: unknown } | null)?.status);
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

type DesktopSessionRestore = {
  token: string | null;
  pending: Promise<string | null> | null;
};

async function loadDesktopSessionToken(): Promise<DesktopSessionRestore> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const tokenRequest = invoke<string | null>('load_session_token');
  try {
    const result = await Promise.race<string | null | undefined>([
      tokenRequest,
      new Promise<undefined>((resolve) => {
        timeoutId = setTimeout(() => resolve(undefined), DESKTOP_SESSION_TIMEOUT_MS);
      }),
    ]);
    return { token: result ?? null, pending: result === undefined ? tokenRequest : null };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function persistDesktopLightModePreference(lightMode: boolean): Promise<void> {
  if (!isDesktop) return;
  try {
    await invoke('set_light_mode_preference', { lightMode });
  } catch (err) {
    console.error('Failed to save desktop light mode preference:', err);
  }
}

async function fetchCurrentUserOnce(): Promise<AuthUser | null> {
  if (!authCheckInFlight) {
    authCheckInFlight = (async () => {
      try {
        const data = await fetchJson<AuthUser>(`${API_URL}/api/auth/me`);
        if (data?.battletag) {
          return data;
        }
        return null;
      } finally {
        authCheckInFlight = null;
      }
    })();
  }
  return authCheckInFlight;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [lanAccessRequired, setLanAccessRequired] = useState(false);
  const [lightMode, setLightMode] = useState(false);
  const [modeInitialized, setModeInitialized] = useState(!isDesktop);

  useEffect(() => {
    if (!isDesktop) {
      setLightMode(localStorage.getItem(LIGHT_MODE_KEY) === '1');
      return;
    }

    let cancelled = false;
    void (async () => {
      let savedLightMode = localStorage.getItem(LIGHT_MODE_KEY) === '1';
      try {
        const preference = await Promise.race([
          invoke<{ light_mode: boolean | null }>('get_light_mode_preference'),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
        ]);
        if (typeof preference?.light_mode === 'boolean') {
          savedLightMode = preference.light_mode;
          if (savedLightMode) {
            localStorage.setItem(LIGHT_MODE_KEY, '1');
            localStorage.removeItem(FULL_MODE_KEY);
          } else {
            localStorage.removeItem(LIGHT_MODE_KEY);
            localStorage.setItem(FULL_MODE_KEY, '1');
          }
        }
      } catch (err) {
        console.error('Failed to restore desktop light mode preference:', err);
      }
      if (!cancelled) {
        setLightMode(savedLightMode);
        setModeInitialized(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('lan_paired') === '1') {
      localStorage.removeItem(LAN_ACCESS_REQUIRED_STORAGE_KEY);
      url.searchParams.delete('lan_paired');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      return;
    }
    if (localStorage.getItem(LAN_ACCESS_REQUIRED_STORAGE_KEY) === '1') {
      setLanAccessRequired(true);
    }
  }, []);

  useEffect(() => {
    const handleLanAccessRevoked = () => {
      localStorage.removeItem(LIGHT_MODE_KEY);
      localStorage.setItem(LAN_ACCESS_REQUIRED_STORAGE_KEY, '1');
      setSessionToken(null);
      setUser(null);
      setLightMode(false);
      setLanAccessRequired(true);
    };

    window.addEventListener(LAN_ACCESS_REVOKED_EVENT, handleLanAccessRevoked);
    return () => window.removeEventListener(LAN_ACCESS_REVOKED_EVENT, handleLanAccessRevoked);
  }, []);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const patchedFetch: typeof window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      if (response.status === 401) {
        const requestUrl = new URL(
          input instanceof Request ? input.url : input.toString(),
          window.location.href
        );
        if (
          requestUrl.origin === window.location.origin &&
          requestUrl.pathname.startsWith('/api/')
        ) {
          const responseText = await response
            .clone()
            .text()
            .catch(() => '');
          if (responseText.includes('LAN pairing required')) {
            window.dispatchEvent(new Event(LAN_ACCESS_REVOKED_EVENT));
          }
        }
      }
      return response;
    };

    window.fetch = patchedFetch;
    return () => {
      if (window.fetch === patchedFetch) window.fetch = originalFetch;
    };
  }, []);

  useEffect(() => {
    if (!modeInitialized) return;
    const checkAuth = async () => {
      if (isDesktop) {
        try {
          const restore = await loadDesktopSessionToken();
          if (restore.token) setSessionToken(restore.token);
          if (restore.pending) {
            void restore.pending
              .then(async (lateToken) => {
                if (!lateToken) return;
                setSessionToken(lateToken);
                try {
                  const lateUser = await fetchCurrentUserOnce();
                  if (lateUser) await switchBrowserUserScope(lateUser.id);
                  setUser(lateUser?.guest ? null : lateUser);
                } catch (lateError) {
                  if (!isTransientAuthError(lateError)) {
                    console.error('Failed to complete delayed desktop session restore:', lateError);
                  }
                }
              })
              .catch((lateError) => {
                console.error('Failed to restore desktop session:', lateError);
              });
          }
        } catch (err) {
          console.error('Failed to restore desktop session:', err);
        }
      }
      const lanBrowser = isLanBrowser();
      const storedLanAccessRequired = localStorage.getItem(LAN_ACCESS_REQUIRED_STORAGE_KEY) === '1';
      if (lightMode && !lanBrowser && !storedLanAccessRequired) {
        await switchBrowserUserScope('local-guest');
        setSessionToken(null);
        setUser(null);
        setLanAccessRequired(false);
        setLoading(false);
        return;
      }
      if (lightMode && (lanBrowser || storedLanAccessRequired)) {
        localStorage.removeItem(LIGHT_MODE_KEY);
        setLightMode(false);
      }
      try {
        const data = await fetchCurrentUserOnce();
        if (data) await switchBrowserUserScope(data.id);
        const fullModeRequested = localStorage.getItem(FULL_MODE_KEY) === '1';
        if (data && !data.guest) localStorage.removeItem(FULL_MODE_KEY);
        setUser(data?.guest ? null : data);
        if (data?.guest && !fullModeRequested) {
          localStorage.setItem(LIGHT_MODE_KEY, '1');
          setLightMode(true);
        }
        localStorage.removeItem(LAN_ACCESS_REQUIRED_STORAGE_KEY);
        setLanAccessRequired(false);
      } catch (err: any) {
        if (!isTransientAuthError(err) && err.status !== 401) {
          console.error('Auth check failed:', err);
        }
        if (isTransientAuthError(err)) {
          // A temporary backend outage must not turn an otherwise valid session
          // into a logout. The next auth-triggering refresh can retry it.
          return;
        }
        // A real 401 means the session is no longer valid.
        setSessionToken(null);
        setUser(null);
        const pairingRequired =
          !isDesktop && err?.status === 401 && err?.code === 'LAN_ACCESS_REQUIRED';
        if (pairingRequired) localStorage.setItem(LAN_ACCESS_REQUIRED_STORAGE_KEY, '1');
        setLanAccessRequired((current) => current || pairingRequired);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [lightMode, modeInitialized]);

  const checkCredentialsStatus = useCallback(async () => {
    if (lightMode) return { globally_configured: false };
    try {
      return await fetchJson<{ globally_configured: boolean }>(
        `${API_URL}/api/auth/bnet/credentials-status`
      );
    } catch (err) {
      if (!isNetworkUnavailableError(err)) {
        console.error('Failed to check credentials status:', err);
      }
    }
    return { globally_configured: false }; // Fallback to avoid dead-end if request fails
  }, [lightMode]);

  const enableLightMode = useCallback(() => {
    if (isLanBrowser() || localStorage.getItem(LAN_ACCESS_REQUIRED_STORAGE_KEY) === '1') {
      localStorage.setItem(LAN_ACCESS_REQUIRED_STORAGE_KEY, '1');
      setLanAccessRequired(true);
      return;
    }
    localStorage.setItem(LIGHT_MODE_KEY, '1');
    localStorage.removeItem(FULL_MODE_KEY);
    void persistDesktopLightModePreference(true);
    void switchBrowserUserScope('local-guest');
    setSessionToken(null);
    setUser(null);
    setLightMode(true);
    setLoading(false);
  }, []);

  const disableLightMode = useCallback(() => {
    localStorage.removeItem(LIGHT_MODE_KEY);
    localStorage.setItem(FULL_MODE_KEY, '1');
    void persistDesktopLightModePreference(false);
    setLightMode(false);
    setLoading(true);
  }, []);

  const setSystemCredentials = useCallback(async (clientId: string, clientSecret: string) => {
    try {
      await saveBlizzardCredentialProfile({
        name: 'Main credentials',
        client_id: clientId,
        client_secret: clientSecret,
      });
      return true;
    } catch (err) {
      console.error('Failed to set system credentials:', err);
      return false;
    }
  }, []);

  const login = useCallback(
    async (
      clientId?: string,
      clientSecret?: string,
      credentialId?: string,
      forceAccountSelection = false
    ) => {
      localStorage.removeItem(LIGHT_MODE_KEY);
      void persistDesktopLightModePreference(false);
      setLightMode(false);
      const flowId = createUuid();
      let url = `${API_URL}/api/auth/bnet/login?flow_id=${flowId}`;

      let selectedCredentialId = credentialId;
      if (!selectedCredentialId && clientId && clientSecret) {
        const profile = await saveBlizzardCredentialProfile({
          name: 'Login credentials',
          client_id: clientId,
          client_secret: clientSecret,
        });
        selectedCredentialId = profile.id;
      }
      if (selectedCredentialId) {
        url += `&credential_id=${encodeURIComponent(selectedCredentialId)}`;
      }
      if (forceAccountSelection) url += '&force_account_selection=true';

      if (isDesktop) {
        startPolling(flowId);
        void (async () => {
          try {
            // Pass raw URL; desktop command encodes once for Blizzard logout ref.
            await invoke('open_auth_window', { url });
          } catch (err) {
            console.error('Failed to use Tauri internal window, falling back to shell:', err);
            try {
              await invoke('open_external_url', { url });
            } catch (shellErr) {
              console.error('Shell fallback failed:', shellErr);
              window.location.assign(url);
            }
          }
        })();
        return;
      }

      window.location.assign(url);
    },
    []
  );

  const startPolling = (flowId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/auth/poll?flow_id=${flowId}`);
        const payload = await res.json().catch(() => ({}));
        if (res.ok) {
          const { token } = payload as { token?: string };
          if (token) {
            setSessionToken(token);
            if (isDesktop) {
              await invoke('save_session_token', { token });
            }
            clearInterval(interval);
            // Refresh user state
            const data = await fetchJson<AuthUser>(`${API_URL}/api/auth/me`);
            await switchBrowserUserScope(data.id);
            setUser(data);
          }
        } else {
          const message =
            (payload as { error?: string; details?: string })?.details ||
            (payload as { error?: string })?.error ||
            'Login flow failed.';
          void message;
          clearInterval(interval);
        }
      } catch (err) {
        console.error('Polling failed:', err);
      }
    }, 2000);

    // Stop polling after 5 minutes
    setTimeout(() => clearInterval(interval), 5 * 60 * 1000);
  };

  const logout = useCallback(
    (switchAccount = false) => {
      const performLocalLogout = () => {
        navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_USER_CACHE' });
        setSessionToken(null);
        if (isDesktop) {
          void invoke('save_session_token', { token: null });
        }
        setUser(null);
        if (switchAccount) {
          void login(undefined, undefined, undefined, true);
        } else {
          window.location.href = '/';
        }
      };

      fetchJson(`${API_URL}/api/auth/logout`, { method: 'POST' })
        .then(performLocalLogout)
        .catch((err) => {
          console.error('Backend logout failed:', err);
          performLocalLogout();
        });
    },
    [login]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        lanAccessRequired,
        lightMode,
        enableLightMode,
        disableLightMode,
        login,
        logout,
        checkCredentialsStatus,
        setSystemCredentials,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
