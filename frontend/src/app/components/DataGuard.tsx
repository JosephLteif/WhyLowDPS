'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { API_URL, fetchJson, isNetworkUnavailableError } from '../lib/api';
import SplashScreen from './SplashScreen';
import { useAuth } from './AuthContext';
import { usePathname } from 'next/navigation';

export default function DataGuard({ children }: { children: React.ReactNode }) {
  const [dataStatus, setDataStatus] = useState<any>({ status: 'syncing', progress: '' });
  const [isReady, setIsReady] = useState<boolean>(() => {
    try {
      return localStorage.getItem('whylowdps_data_ready') === 'true';
    } catch {
      return false;
    }
  });
  const { user, loading, checkCredentialsStatus } = useAuth();
  const [isGloballyConfigured, setIsGloballyConfigured] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  const safeText = (value: unknown, fallback = ''): string => {
    if (typeof value === 'string') return value;
    if (value == null) return fallback;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (typeof obj.detail === 'string') return obj.detail;
      if (typeof obj.error === 'string') return `error: ${obj.error}`;
      try {
        return JSON.stringify(value);
      } catch {
        return fallback;
      }
    }
    return fallback;
  };

  const toSplashStatus = (value: unknown): string => {
    const text = safeText(value, 'syncing').trim();
    if (!text) return 'syncing';
    if (text === 'ready') return 'syncing';
    if (text === 'syncing' || text === 'unauthenticated' || text === 'unauthenticated_needs_keys') {
      return text;
    }
    const lower = text.toLowerCase();
    if (lower.includes('error') || lower.includes('failed') || lower.includes('invalid')) {
      return text;
    }
    return 'syncing';
  };

  const toSplashProgress = (value: unknown): string => safeText(value, 'Syncing with Blizzard...');

  useEffect(() => {
    let cancelled = false;
    setIsChecking(true);
    checkCredentialsStatus()
      .then((status) => {
        if (cancelled) return;
        setIsGloballyConfigured(status.globally_configured);
      })
      .catch((err) => {
        if (cancelled) return;
        if (!isNetworkUnavailableError(err)) {
          console.error('[DataGuard] Credentials status check failed:', err);
        }
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
        try {
          localStorage.setItem('whylowdps_data_ready', 'true');
        } catch {}
      } else if (data.status === 'needs_credentials') {
        setIsReady(false);
        try {
          localStorage.removeItem('whylowdps_data_ready');
        } catch {}
        setDataStatus({ status: 'syncing', progress: 'Initializing synchronization...' });
        fetchJson(`${API_URL}/api/data/sync`, { method: 'POST' }).catch(() => {});
      } else {
        setIsReady(false);
        try {
          localStorage.removeItem('whylowdps_data_ready');
        } catch {}
        setDataStatus(data);
      }
    } catch (err) {
      if (!isNetworkUnavailableError(err)) {
        console.error('Failed to fetch data status:', err);
      }
      setIsReady(false);
      try {
        localStorage.removeItem('whylowdps_data_ready');
      } catch {}
      setDataStatus({ status: 'syncing', progress: 'Waiting for backend to start...' });
    }
  }, []);

  useEffect(() => {
    setDataStatus({ status: 'syncing', progress: 'Initializing synchronization...' });
    fetchJson(`${API_URL}/api/data/sync`, { method: 'POST' })
      .catch(() => {})
      .finally(() => {
        checkStatus();
      });

    const interval = setInterval(() => {
      checkStatus();
    }, 2000);

    return () => clearInterval(interval);
  }, [checkStatus]);

  const handleRetry = () => {
    fetchJson(`${API_URL}/api/data/sync`, { method: 'POST' })
      .catch(() => {})
      .finally(() => checkStatus());
  };

  const pathname = usePathname();
  const normalizedPath =
    pathname.endsWith('/') && pathname !== '/' ? pathname.slice(0, -1) : pathname;
  const isSettingsPage = normalizedPath === '/settings';

  if ((loading || isChecking) && !isSettingsPage) {
    return null;
  }

  if (user && !isSettingsPage) {
    if (!isReady) {
      return (
        <SplashScreen
          status={toSplashStatus(dataStatus?.status)}
          progress={toSplashProgress(dataStatus?.progress)}
          onRetry={handleRetry}
        />
      );
    }
    return <>{children}</>;
  }

  if (isGloballyConfigured === false && !isSettingsPage) {
    return <SplashScreen status="unauthenticated_needs_keys" progress="" />;
  }

  if (!user && !isSettingsPage) {
    return <SplashScreen status="unauthenticated" progress="" />;
  }

  if (!isReady && !isSettingsPage) {
    return (
      <SplashScreen
        status={toSplashStatus(dataStatus?.status)}
        progress={toSplashProgress(dataStatus?.progress)}
        onRetry={handleRetry}
      />
    );
  }

  return <>{children}</>;
}
