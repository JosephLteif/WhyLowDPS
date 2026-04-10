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
    // Initial check
    checkStatus();

    // Start sync if ready and not syncing
    fetchJson(`${API_URL}/api/data/sync`, { method: 'POST' }).catch(() => {});

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

  // While we're still performing initial auth/credential checks, don't show the "needs keys" screen
  if (loading || isChecking) {
    return null; // Or a minimal full-screen spinner
  }

  // Allow unauthenticated access if the system is globally configured with Blizzard keys.
  // In a local/desktop app, this allows using character lookup features without a personal login.
  if (!user && !isGloballyConfigured && !isSettingsPage) {
    return (
      <SplashScreen
        status="unauthenticated_needs_keys"
        progress=""
      />
    );
  }

  if (!isReady && !isSettingsPage) {
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
