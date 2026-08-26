'use client';

import { useEffect } from 'react';

export const PWA_UPDATE_EVENT = 'whylowdps:pwa-update-available';

export default function PwaRegistration() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== 'production' ||
      process.env.NEXT_PUBLIC_DEPLOYMENT_MODE !== 'hosted-private' ||
      !('serviceWorker' in navigator) ||
      window.location.protocol !== 'https:'
    ) {
      return;
    }

    let registration: ServiceWorkerRegistration | undefined;
    let cancelled = false;

    const announceUpdate = () => {
      if (cancelled) return;
      window.dispatchEvent(new Event(PWA_UPDATE_EVENT));
    };

    const watchRegistration = (next: ServiceWorkerRegistration) => {
      registration = next;
      if (next.waiting) announceUpdate();
      next.addEventListener('updatefound', () => {
        const worker = next.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            announceUpdate();
          }
        });
      });
    };

    void navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(watchRegistration)
      .catch(() => {});

    const onControllerChange = () => {
      if (registration?.waiting) announceUpdate();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  return null;
}
