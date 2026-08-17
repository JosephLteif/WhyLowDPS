'use client';

import { useEffect } from 'react';
import { API_URL, isDesktop } from '../lib/api';

const PRESENCE_INTERVAL_MS = 30_000;
const PRESENCE_PATH = `${API_URL}/api/lan/presence`;
const DISCONNECT_PATH = `${API_URL}/api/lan/disconnect`;

function isLanHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return false;
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function sendPresence(): void {
  void fetch(PRESENCE_PATH, {
    credentials: 'include',
    cache: 'no-store',
  }).catch(() => {});
}

function sendDisconnect(): void {
  if (navigator.sendBeacon?.(DISCONNECT_PATH)) return;
  void fetch(DISCONNECT_PATH, {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
  }).catch(() => {});
}

export default function LanSessionLifecycle() {
  useEffect(() => {
    if (isDesktop || !isLanHost(window.location.hostname)) return;

    let presenceTimer: number | null = null;
    let disconnectSent = false;

    const stopPresence = () => {
      if (presenceTimer === null) return;
      window.clearInterval(presenceTimer);
      presenceTimer = null;
    };

    const startPresence = () => {
      if (document.visibilityState === 'hidden' || presenceTimer !== null) return;
      disconnectSent = false;
      sendPresence();
      presenceTimer = window.setInterval(sendPresence, PRESENCE_INTERVAL_MS);
    };

    const markDisconnected = () => {
      stopPresence();
      if (disconnectSent) return;
      disconnectSent = true;
      sendDisconnect();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        markDisconnected();
      } else {
        startPresence();
      }
    };

    const handlePageShow = () => {
      if (document.visibilityState !== 'hidden') startPresence();
    };

    startPresence();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', markDisconnected);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      stopPresence();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', markDisconnected);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  return null;
}
