'use client';

import { useEffect, useRef, useState } from 'react';
import { isDesktopRuntime } from '../lib/api';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const installPromptSeenKey = 'whylowdps_pwa_install_prompt_seen';

function isStandaloneDisplayMode() {
  return (
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches) ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function isSecureInstallContext() {
  const isLocalhost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(
    window.location.hostname
  );
  return (window.location.protocol === 'https:' || isLocalhost) && window.isSecureContext !== false;
}

export default function PwaInstallPrompt() {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [iosDevice, setIosDevice] = useState(false);

  useEffect(() => {
    if (
      isDesktopRuntime() ||
      isStandaloneDisplayMode() ||
      !isSecureInstallContext() ||
      window.localStorage.getItem(installPromptSeenKey) === '1'
    ) {
      return;
    }

    window.localStorage.setItem(installPromptSeenKey, '1');
    setOpen(true);
    setIosDevice(isIosDevice());

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      deferredPrompt.current = event as BeforeInstallPromptEvent;
      setAvailable(true);
    };
    const onAppInstalled = () => {
      deferredPrompt.current = null;
      setAvailable(false);
      setOpen(false);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  if (!open) return null;

  const dismiss = () => {
    deferredPrompt.current = null;
    setAvailable(false);
    setOpen(false);
  };

  const install = async () => {
    const promptEvent = deferredPrompt.current;
    if (!promptEvent) return;

    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
    } catch {
      // The browser owns the install dialog; close our prompt if it becomes unavailable.
    } finally {
      deferredPrompt.current = null;
      setAvailable(false);
      setOpen(false);
    }
  };

  const description = available
    ? 'Keep simulations one tap away.'
    : iosDevice
      ? 'Tap Share, then Add to Home Screen to install the app.'
      : 'Use your browser menu and choose Install WhyLowDPS.';

  return (
    <div
      role="dialog"
      aria-label="Install WhyLowDPS"
      className="mobile-fixed-bottom fixed inset-x-3 z-[180] mx-auto flex max-w-lg items-center gap-3 rounded-xl border border-gold/30 bg-surface/95 px-4 py-3 text-sm text-zinc-100 shadow-2xl backdrop-blur"
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Install WhyLowDPS as an app</p>
        <p className="mt-0.5 text-xs text-zinc-400">{description}</p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded-lg px-3 py-2 text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
      >
        Not now
      </button>
      {available ? (
        <button
          type="button"
          onClick={() => void install()}
          className="shrink-0 rounded-lg bg-gold px-3 py-2 font-semibold text-black transition-colors hover:bg-gold-light"
        >
          Install
        </button>
      ) : null}
    </div>
  );
}
