'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ActiveCharacter } from '../lib/active-character';
import {
  readStoredActiveCharacter,
  writeStoredActiveCharacter,
} from '../lib/active-character';

type ActiveCharacterContextValue = {
  character: ActiveCharacter | null;
  hydrated: boolean;
  setCharacter: (character: ActiveCharacter | null) => void;
  clearCharacter: () => void;
};

const ActiveCharacterContext = createContext<ActiveCharacterContextValue | null>(null);

export function ActiveCharacterProvider({ children }: { children: React.ReactNode }) {
  const [character, setCharacterState] = useState<ActiveCharacter | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setCharacterState(readStoredActiveCharacter(window.localStorage));
    setHydrated(true);

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'whylowdps_active_character_v1') {
        setCharacterState(readStoredActiveCharacter(window.localStorage));
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setCharacter = useCallback((next: ActiveCharacter | null) => {
    setCharacterState(next);
    writeStoredActiveCharacter(window.localStorage, next);
  }, []);

  const clearCharacter = useCallback(() => setCharacter(null), [setCharacter]);

  const value = useMemo(
    () => ({ character, hydrated, setCharacter, clearCharacter }),
    [character, clearCharacter, hydrated, setCharacter]
  );

  return <ActiveCharacterContext.Provider value={value}>{children}</ActiveCharacterContext.Provider>;
}

export function useActiveCharacter(): ActiveCharacterContextValue {
  const context = useContext(ActiveCharacterContext);
  if (!context) throw new Error('useActiveCharacter must be used inside ActiveCharacterProvider');
  return context;
}
