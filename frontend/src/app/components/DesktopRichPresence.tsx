'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import { isDesktop } from '../lib/api';
import { useActiveCharacter } from './ActiveCharacterContext';

export default function DesktopRichPresence() {
  const pathname = usePathname() || '/';
  const { character, hydrated } = useActiveCharacter();

  const updatePresence = useCallback(async () => {
    if (!isDesktop || !hydrated) return;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('update_discord_presence', {
        update: {
          route: pathname,
          character_name: character?.name ?? null,
          realm: character?.realm ?? null,
        },
      });
    } catch {
      // Rich Presence is optional and should never affect the app workflow.
    }
  }, [character?.name, character?.realm, hydrated, pathname]);

  useEffect(() => {
    if (!isDesktop || !hydrated) return;

    void updatePresence();
    const interval = window.setInterval(() => void updatePresence(), 30_000);
    return () => window.clearInterval(interval);
  }, [hydrated, updatePresence]);

  return null;
}
