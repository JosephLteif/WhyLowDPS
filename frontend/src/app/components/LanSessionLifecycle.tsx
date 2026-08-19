'use client';

import { useEffect } from 'react';
import { API_URL, isDesktop, isLanBrowser, isLanHost, LAN_ACCESS_REVOKED_EVENT } from '../lib/api';

const PRESENCE_INTERVAL_MS = 30_000;
const PRESENCE_PATH = `${API_URL}/api/lan/presence`;
const DISCONNECT_PATH = `${API_URL}/api/lan/disconnect`;

async function sendPresence(): Promise<void> {
  try {
    const response = await fetch(PRESENCE_PATH, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (response.status === 401) {
      window.dispatchEvent(new Event(LAN_ACCESS_REVOKED_EVENT));
    }
  } catch {}
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
    if (
      isDesktop ||
      (typeof window !== 'undefined' &&
        !isLanBrowser() &&
        !isLanHost(window.location.hostname))
    ) {
      return;
    }

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
