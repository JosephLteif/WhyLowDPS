'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { API_URL } from '../lib/api';
import SplashScreen from './SplashScreen';
import { useAuth } from './AuthContext';
import { usePathname } from 'next/navigation';

export default function DataGuard({ children }: { children: React.ReactNode }) {
  const [dataStatus, setDataStatus] = useState<any>({ status: 'syncing', progress: '' });
  const [isReady, setIsReady] = useState(false);
  const { user, checkCredentialsStatus } = useAuth();
  const [showSetup, setShowSetup] = useState(false);
  const [isGloballyConfigured, setIsGloballyConfigured] = useState(true);

  useEffect(() => {
    checkCredentialsStatus().then((status) => {
      setIsGloballyConfigured(status.globally_configured);
    });
  }, [checkCredentialsStatus, user]);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/data/status`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();

        if (data.status === 'ready') {
          setDataStatus(data);
          setIsReady(true);
        } else if (data.status === 'needs_credentials') {
          if (data.can_sync) {
            // Trigger a sync if we have keys (system or user) available
            setDataStatus({ status: 'syncing', progress: 'Initializing synchronization...' });
            fetch(`${API_URL}/api/data/sync`, { method: 'POST', credentials: 'include' }).catch(
              () => {}
            );
          } else {
            // Check if we have global credentials (backup check)
            const creds = await checkCredentialsStatus();
            if (creds.globally_configured) {
              setDataStatus({ status: 'syncing', progress: 'Initializing synchronization...' });
              fetch(`${API_URL}/api/data/sync`, { method: 'POST', credentials: 'include' }).catch(
                () => {}
              );
            } else {
              // Only now show the needs_credentials status (shows the Configure button)
              setDataStatus(data);
            }
          }
        } else {
          setDataStatus(data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch data status:', err);
      setDataStatus({ status: 'Error', progress: 'Connection failed. Is the backend running?' });
    }
  }, [checkCredentialsStatus]);

  useEffect(() => {
    // Initial check
    checkStatus();

    // Start sync if ready and not syncing
    fetch(`${API_URL}/api/data/sync`, { method: 'POST', credentials: 'include' }).catch(() => {});

    // Poll while not ready
    const interval = setInterval(() => {
      if (!isReady) {
        checkStatus();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isReady, checkStatus]);

  const handleRetry = () => {
    fetch(`${API_URL}/api/data/sync`, { method: 'POST' }).then(() => checkStatus());
  };

  const handleConfigureKeys = () => {
    // For now, Redirect to settings or just show the setup message
    window.location.href = '/settings';
  };

  const pathname = usePathname();
  const isSettingsPage = pathname === '/settings';

  if (!user && !isSettingsPage) {
    return (
      <SplashScreen
        status={isGloballyConfigured ? 'unauthenticated' : 'unauthenticated_needs_keys'}
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
        onConfigureKeys={handleConfigureKeys}
      />
    );
  }

  return <>{children}</>;
}
