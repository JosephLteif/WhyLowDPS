'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { API_URL, TOKEN_KEY, fetchJson } from '../lib/api';
import SplashScreen from './SplashScreen';
import { useAuth } from './AuthContext';
import { usePathname } from 'next/navigation';

export default function DataGuard({ children }: { children: React.ReactNode }) {
  const [dataStatus, setDataStatus] = useState<any>({ status: 'syncing', progress: '' });
  const [isReady, setIsReady] = useState(false);
  const { user, loading, checkCredentialsStatus } = useAuth();
  const [showSetup, setShowSetup] = useState(false);
  const [isGloballyConfigured, setIsGloballyConfigured] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    setIsChecking(true);
    checkCredentialsStatus().then((status) => {
      console.log('[DataGuard] Credentials status:', status);
      setIsGloballyConfigured(status.globally_configured);
      setIsChecking(false);
    });
  }, [checkCredentialsStatus, user]);

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
      console.error('Failed to fetch data status:', err);
      setDataStatus({ status: 'Error', progress: 'Connection failed. Is the backend running?' });
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
  if ((loading || isChecking) && !isGloballyConfigured && !user && !isSettingsPage) {
    return null;
  }

  // 2. If the system is not configured with Blizzard keys, show setup screen
  if (!isGloballyConfigured && !isSettingsPage) {
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
