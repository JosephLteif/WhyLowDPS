'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { Map, Search, Trash2, X } from 'lucide-react';
import { parseCharacterInfo } from '@/lib/simc-parser';
import { useDismissOnOutside } from '../lib/useDismissOnOutside';
import type { SavedRoute } from '../lib/types';

type RouteSelectorModalProps = {
  isOpen: boolean;
  onClose: () => void;
  routes: SavedRoute[];
  onSelect: (route: SavedRoute) => void;
  onDelete: (id: string) => void;
};

type RouteCard = {
  route: SavedRoute;
  pulls: number;
  enemyCount: number;
  lustPulls: number;
  totalHp: number;
  timerSeconds: number;
  affixes: string[];
  lastUpdated: Date;
};

function formatHealthCompact(hp: number): string {
  if (!Number.isFinite(hp) || hp <= 0) return '-';
  if (hp >= 1_000_000_000) return `${(hp / 1_000_000_000).toFixed(1)}B`;
  if (hp >= 1_000_000) return `${(hp / 1_000_000).toFixed(1)}M`;
  if (hp >= 1_000) return `${(hp / 1_000).toFixed(0)}K`;
  return hp.toString();
}

function formatTimer(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '-';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function toRouteCard(route: SavedRoute): RouteCard {
  const parsed = parseCharacterInfo(route.route_data);
  const dungeonInfo = parsed?.kind === 'dungeon' ? parsed : null;
  const pulls = dungeonInfo?.pulls ?? [];
  const enemyCount = pulls.reduce((sum, pull) => sum + pull.enemies.length, 0);
  const lustPulls = pulls.filter((pull) => pull.bloodlust).length;
  const totalHp = pulls.reduce((sum, pull) => sum + (pull.totalHealth || 0), 0);
  const timerSeconds = route.timer_seconds || (dungeonInfo?.maxTime ? Number(dungeonInfo.maxTime) : 0);
  const affixes = (route.affixes || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    route,
    pulls: route.pull_count || dungeonInfo?.pullCount || pulls.length,
    enemyCount,
    lustPulls,
    totalHp,
    timerSeconds,
    affixes,
    lastUpdated: new Date(route.created_at),
  };
}

export default function RouteSelectorModal({
  isOpen,
  onClose,
  routes,
  onSelect,
  onDelete,
}: RouteSelectorModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutside(modalRef, isOpen, onClose);

  const routeCards = useMemo(() => routes.map(toRouteCard), [routes]);
  const [searchQuery, setSearchQuery] = useState('');
  const [dungeonFilter, setDungeonFilter] = useState('all');

  const dungeonOptions = useMemo(() => {
    return Array.from(new Set(routeCards.map((card) => card.route.dungeon).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [routeCards]);

  const filteredRouteCards = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return routeCards.filter((card) => {
      if (dungeonFilter !== 'all' && card.route.dungeon !== dungeonFilter) return false;
      if (!query) return true;
      const haystack = [card.route.name, card.route.dungeon, card.affixes.join(' '), String(card.route.level || '')]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [routeCards, searchQuery, dungeonFilter]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={modalRef}
        className="relative flex max-h-[84vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-white/5 p-4">
          <div className="flex items-center gap-2">
            <Map className="h-5 w-5 text-sky-400" strokeWidth={2} />
            <h2 className="text-lg font-bold text-white">Select Saved Route</h2>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X className="h-6 w-6" strokeWidth={2} />
          </button>
        </div>
        <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] px-4 py-3 text-xs text-zinc-400">
          <span>
            {filteredRouteCards.length} of {routes.length} saved route{routes.length === 1 ? '' : 's'}
          </span>
          <span>Choose one to load into Dungeon Route configuration</span>
        </div>
        <div className="grid grid-cols-1 gap-2 border-b border-white/5 bg-white/[0.01] px-4 py-3 md:grid-cols-[1fr_220px_auto] md:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" strokeWidth={2} />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search route, dungeon, affix, level..."
              className="w-full rounded-md border border-white/10 bg-zinc-900 py-1.5 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-sky-400/50 focus:outline-none"
            />
          </div>
          <select
            value={dungeonFilter}
            onChange={(event) => setDungeonFilter(event.target.value)}
            className="rounded-md border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-200 focus:border-sky-400/50 focus:outline-none"
          >
            <option value="all">All dungeons</option>
            {dungeonOptions.map((dungeon) => (
              <option key={dungeon} value={dungeon}>
                {dungeon}
              </option>
            ))}
          </select>
          <Link
            href="/dungeon-routes"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-md border border-sky-400/35 bg-sky-500/10 px-3 py-1.5 text-sm font-semibold text-sky-300 transition-all hover:bg-sky-500/20"
          >
            Open Dungeon Routes
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {routes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
              <p>No saved routes yet.</p>
            </div>
          ) : filteredRouteCards.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
              <p>No routes match the current filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {filteredRouteCards.map((card) => (
                <div
                  key={card.route.id}
                  className="group relative overflow-hidden rounded-xl border border-white/5 bg-gradient-to-b from-white/[0.04] to-white/[0.015] p-3 transition-all hover:border-sky-400/30 hover:shadow-[0_0_0_1px_rgba(56,189,248,0.18)]"
                >
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-sky-400/0 via-sky-400/35 to-sky-400/0 opacity-0 transition-opacity group-hover:opacity-100" />
                  <button
                    onClick={() => {
                      onSelect(card.route);
                      onClose();
                    }}
                    className="w-full text-left"
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-[15px] font-bold text-zinc-100 transition-colors group-hover:text-sky-300">
                            {card.route.name}
                          </div>
                          <div className="shrink-0 rounded-md border border-sky-400/35 bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-300">
                            +{card.route.level || 0}
                          </div>
                        </div>
                        <div className="mt-0.5 text-[12px] text-zinc-500">{card.route.dungeon}</div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded-md border border-white/5 bg-black/20 px-2 py-1">
                        <div className="text-zinc-500">Pulls</div>
                        <div className="font-semibold text-zinc-200">{card.pulls || '-'}</div>
                      </div>
                      <div className="rounded-md border border-white/5 bg-black/20 px-2 py-1">
                        <div className="text-zinc-500">Timer</div>
                        <div className="font-semibold text-zinc-200">{formatTimer(card.timerSeconds)}</div>
                      </div>
                      <div className="rounded-md border border-white/5 bg-black/20 px-2 py-1">
                        <div className="text-zinc-500">Enemies</div>
                        <div className="font-semibold text-zinc-200">{card.enemyCount || '-'}</div>
                      </div>
                      <div className="rounded-md border border-white/5 bg-black/20 px-2 py-1">
                        <div className="text-zinc-500">Bloodlust</div>
                        <div className="font-semibold text-zinc-200">{card.lustPulls} pulls</div>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {card.affixes.length > 0 ? (
                        card.affixes.slice(0, 4).map((affix) => (
                          <span
                            key={`${card.route.id}-${affix}`}
                            className="rounded-full border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300"
                          >
                            {affix}
                          </span>
                        ))
                      ) : (
                        <span className="rounded-full border border-zinc-700 bg-zinc-800/40 px-2 py-0.5 text-[10px] text-zinc-400">
                          No affixes saved
                        </span>
                      )}
                    </div>

                    <div className="mt-2 text-[10px] text-zinc-500">
                      Total HP: <span className="font-semibold text-zinc-300">{formatHealthCompact(card.totalHp)}</span>
                      <span className="mx-1 text-zinc-700">•</span>
                      Updated {card.lastUpdated.toLocaleDateString()}
                    </div>
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(card.route.id);
                    }}
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-zinc-600 transition-all hover:bg-red-500/10 hover:text-red-400"
                    title="Delete saved route"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={2} />
                  </button>
                  <div className="absolute bottom-2 right-3 text-[10px] text-zinc-600 transition-colors group-hover:text-zinc-400">
                    Click to load route
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
