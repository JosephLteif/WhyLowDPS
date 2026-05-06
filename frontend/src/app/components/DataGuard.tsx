'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { API_URL, fetchJson, isNetworkUnavailableError } from '../lib/api';
import SplashScreen from './SplashScreen';
import { useAuth } from './AuthContext';
import { usePathname } from 'next/navigation';

export default function DataGuard({ children }: { children: React.ReactNode }) {
  const [dataStatus, setDataStatus] = useState<any>({ status: 'syncing', progress: '' });
  const [isReady, setIsReady] = useState(false);
  const { user, loading, checkCredentialsStatus } = useAuth();
  const [showSetup, setShowSetup] = useState(false);
  const [isGloballyConfigured, setIsGloballyConfigured] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsChecking(true);
    checkCredentialsStatus()
      .then((status) => {
        if (cancelled) return;
        console.log('[DataGuard] Credentials status:', status);
        setIsGloballyConfigured(status.globally_configured);
      })
      .catch((err) => {
        if (cancelled) return;
        if (!isNetworkUnavailableError(err)) {
          console.error('[DataGuard] Credentials status check failed:', err);
        }
        // Keep previous value on transient errors to avoid splash-state flapping.
      })
      .finally(() => {
        if (cancelled) return;
        setIsChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [checkCredentialsStatus]);

  const checkStatus = useCallback(async () => {
    try {
      const data = await fetchJson<any>(`${API_URL}/api/data/status`);

      if (data.status === 'ready') {
        setDataStatus(data);
        setIsReady(true);
      } else if (data.status === 'needs_credentials') {
        // Trigger a sync assuming credentials are configured
        setDataStatus({ status: 'syncing', progress: 'Initializing synchronization...' });
        fetchJson(`${API_URL}/api/data/sync`, { method: 'POST' }).catch(() => {});
      } else {
        setDataStatus(data);
      }
    } catch (err) {
      if (!isNetworkUnavailableError(err)) {
        console.error('Failed to fetch data status:', err);
      }
      setDataStatus({ status: 'syncing', progress: 'Waiting for backend to start...' });
    }
  }, []);

  useEffect(() => {
    // Trigger sync first so fresh installs do not report "ready" before initial data load.
    setDataStatus({ status: 'syncing', progress: 'Initializing synchronization...' });
    fetchJson(`${API_URL}/api/data/sync`, { method: 'POST' })
      .catch(() => {})
      .finally(() => {
        checkStatus();
      });

    // Poll while not ready
    const interval = setInterval(() => {
      if (!isReady) {
        checkStatus();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isReady, checkStatus]);

  const handleRetry = () => {
    fetchJson(`${API_URL}/api/data/sync`, { method: 'POST' }).then(() => checkStatus());
  };

  const pathname = usePathname();
  const isSettingsPage = pathname === '/settings';

  // 1. Initial configuration check (no data yet)
  if ((loading || isChecking) && !isSettingsPage) {
    return null;
  }

  // If user is already authenticated, don't bounce back to auth/setup splash.
  if (user && !isSettingsPage) {
    if (!isReady) {
      return (
        <SplashScreen
          status={dataStatus.status}
          progress={dataStatus.progress}
          onRetry={handleRetry}
        />
      );
    }
    return <>{children}</>;
  }

  // 2. If the system is not configured with Blizzard keys, show setup screen
  if (isGloballyConfigured === false && !isSettingsPage) {
    return <SplashScreen status="unauthenticated_needs_keys" progress="" />;
  }

  // 3. If the system is configured but the user is not logged in, show login screen
  if (!user && !isSettingsPage) {
    return <SplashScreen status="unauthenticated" progress="" />;
  }

  // 4. If data is not ready, show syncing splash screen (only if not on settings)
  if (!isReady && !isSettingsPage) {
    return (
      <SplashScreen
        status={dataStatus.status}
        progress={dataStatus.progress}
        onRetry={handleRetry}
      />
    );
  }

  // 5. Default: show application content
  return <>{children}</>;
}
