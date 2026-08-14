'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import { isDesktop } from '../lib/api';
import { useActiveCharacter } from './ActiveCharacterContext';

export default function DesktopRichPresence() {
  const pathname = usePathname() || '/';
  const { character, hydrated } = useActiveCharacter();
  const startedAtRef = useRef<number | null>(null);
  const contextRef = useRef<string | null>(null);
  const contextKey = `${pathname}|${character?.name ?? ''}|${character?.realm ?? ''}`;

  const updatePresence = useCallback(async () => {
    if (!isDesktop || !hydrated) return;

    if (contextRef.current !== contextKey) {
      contextRef.current = contextKey;
      startedAtRef.current = Math.floor(Date.now() / 1000);
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('update_discord_presence', {
        update: {
          route: pathname,
          character_name: character?.name ?? null,
          realm: character?.realm ?? null,
          started_at: startedAtRef.current,
        },
      });
    } catch {
      // Rich Presence is optional and should never affect the app workflow.
    }
  }, [character?.name, character?.realm, contextKey, hydrated, pathname]);

  useEffect(() => {
    if (!isDesktop || !hydrated) return;

    void updatePresence();
    const interval = window.setInterval(() => void updatePresence(), 30_000);
    return () => window.clearInterval(interval);
  }, [hydrated, updatePresence]);

  return null;
}
