'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';

const SIDEBAR_ORDER_KEY = 'whylowdps_sidebar_order';

const LABEL_TO_HREF: Record<string, string> = {
  Sim: '/quick-sim',
  Analysis: '/analysis/quick-weights',
  Dashboard: '/',
  Upgrades: '/drop-finder',
  'Dungeons & Routes': '/dungeons',
  History: '/history',
  'My Characters': '/characters',
  Settings: '/settings',

  // Legacy labels kept for backward compatibility with older saved sidebar order/state.
  'Quick Sim': '/quick-sim',
  'Stat Weights': '/analysis/quick-weights',
  'Top Gear': '/top-gear',
  'Quick Weights': '/analysis/quick-weights',
  'Stat Plot': '/analysis/stat-plot',
  'Consumable Matrix': '/analysis/consumable-matrix',
  'Tier Slot Matrix': '/analysis/tier-slot-matrix',
  'Drop Finder': '/drop-finder',
  Wishlist: '/wishlist',
  Trinkets: '/upgrade/trinkets',
  'Crest Upgrades': '/upgrade-compare',
};

const AUTH_ONLY_LABELS = new Set<string>(['My Characters', 'Settings']);

export default function InitialSidebarRoute() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (redirectedRef.current) return;
    if (loading) return;
    if (pathname !== '/') return;

    let order: string[] = [];
    try {
      const raw = localStorage.getItem(SIDEBAR_ORDER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          order = parsed.filter((v): v is string => typeof v === 'string');
        }
      }
    } catch {
      order = [];
    }

    if (order.length === 0) return;

    for (const label of order) {
      if (!user && AUTH_ONLY_LABELS.has(label)) continue;
      const href = LABEL_TO_HREF[label];
      if (!href) continue;
      if (href === '/') return;
      redirectedRef.current = true;
      router.replace(href);
      return;
    }
  }, [loading, pathname, router, user]);

  return null;
}
