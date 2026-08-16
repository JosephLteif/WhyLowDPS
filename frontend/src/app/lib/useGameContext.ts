'use client';

import { useEffect, useState } from 'react';
import { getGameContext, type GameContext } from './api';

let cachedContext: GameContext | null = null;
let contextPromise: Promise<GameContext | null> | null = null;

function loadContext(): Promise<GameContext | null> {
  if (cachedContext) return Promise.resolve(cachedContext);
  if (!contextPromise) {
    contextPromise = getGameContext()
      .then((context) => {
        cachedContext = context;
        return context;
      })
      .catch(() => null);
  }
  return contextPromise;
}

export function useGameContext(): GameContext | null {
  const [context, setContext] = useState<GameContext | null>(cachedContext);

  useEffect(() => {
    let cancelled = false;
    void loadContext().then((next) => {
      if (!cancelled && next) setContext(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return context;
}

