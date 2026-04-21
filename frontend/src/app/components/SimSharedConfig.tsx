'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { invoke } from '@tauri-apps/api/core';
import { useSimContext } from './SimContext';
import FightStyleSelector from './FightStyleSelector';
import ScenarioBuilder from './ScenarioBuilder';
import TalentPicker from './TalentPicker';
import {
  API_URL,
  deleteCharacterProfile,
  deleteSavedRoute,
  fetchJson,
  getSimcStatus,
  isDesktop,
  listCharacterProfiles,
  listSavedRoutes,
  saveCharacterProfile,
  SavedCharacterProfile,
  saveRoute,
} from '../lib/api';
import { CLASS_COLORS, SavedRoute, specDisplayName } from '../lib/types';
import { parseCharacterInfo, PullInfo, SimcClipboardInfo } from '@/lib/simc-parser';
import { convertMdtToSimc, isMdtString, parseMdtString } from '@/lib/mdt-parser';
import { getFightStyleParamRules } from '../lib/fight-style';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import { useConsumableOptions } from '../lib/useConsumableOptions';
import { OptionEntry, RAID_BUFF_MATRIX_OPTIONS } from '../lib/sim-options-catalog';
import RouteDetailsModal from './RouteDetailsModal';
import ConfirmModal from './ConfirmModal';
import { useDismissOnOutside } from '../lib/useDismissOnOutside';

/** Adler-32 checksum matching the SimC addon's implementation.
 *  The Lua addon processes raw UTF-8 bytes, so we must do the same. */
function adler32(s: string): number {
  const prime = 65521;
  let s1 = 1;
  let s2 = 0;
  const bytes = new TextEncoder().encode(s);
  for (let i = 0; i < bytes.length; i++) {
    s1 = (s1 + bytes[i]) % prime;
    s2 = (s2 + s1) % prime;
  }
  return ((s2 << 16) | s1) >>> 0;
}

/** Validate the SimC addon checksum. Returns null if valid or no checksum present. */
function validateChecksum(input: string): 'valid' | 'invalid' | null {
  const match = input.match(/^#\s*Checksum:\s*([0-9a-fA-F]+)\s*$/m);
  if (!match) return null;
  const expected = parseInt(match[1], 16);
  // The checksum covers everything before the checksum line.
  // The SimC addon may compute with \r\n or \n line endings depending on OS.
  // Browsers normalize textarea input to \n, so try both.
  const idx = input.indexOf(match[0]);
  const body = input.substring(0, idx);
  if (adler32(body) === expected) return 'valid';
  if (adler32(body.replace(/\n/g, '\r\n')) === expected) return 'valid';
  return 'invalid';
}

const SPELL_ICON_CACHE = new Map<number, string>();
const ITEM_ICON_CACHE = new Map<number, string>();

function useSpellIcons(spellIds: number[]) {
  const [icons, setIcons] = useState<Map<number, string>>(new Map());
  const depKey = spellIds.join(',');

  useEffect(() => {
    const missing = spellIds.filter((id) => id > 0 && !SPELL_ICON_CACHE.has(id));
    if (missing.length === 0) {
      setIcons(new Map(SPELL_ICON_CACHE));
      return;
    }

    let cancelled = false;
    Promise.all(
      missing.map(async (id) => {
        try {
          const res = await fetch(
            `https://nether.wowhead.com/tooltip/spell/${id}?dataEnv=1&locale=0`,
          );
          if (!res.ok) return;
          const data = await res.json();
          if (data?.icon) SPELL_ICON_CACHE.set(id, data.icon);
        } catch {
          // Ignore fetch failures and fall back to the catalog slug.
        }
      })
    ).then(() => {
      if (!cancelled) setIcons(new Map(SPELL_ICON_CACHE));
    });

    return () => {
      cancelled = true;
    };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return icons;
}

function useItemIcons(itemIds: number[]) {
  const [icons, setIcons] = useState<Map<number, string>>(new Map());
  const depKey = itemIds.join(',');

  useEffect(() => {
    const missing = itemIds.filter((id) => id > 0 && !ITEM_ICON_CACHE.has(id));
    if (missing.length === 0) {
      setIcons(new Map(ITEM_ICON_CACHE));
      return;
    }

    let cancelled = false;
    Promise.all(
      missing.map(async (id) => {
        try {
          const res = await fetch(
            `https://nether.wowhead.com/tooltip/item/${id}?dataEnv=1&locale=0`,
          );
          if (!res.ok) return;
          const data = await res.json();
          if (data?.icon) ITEM_ICON_CACHE.set(id, data.icon);
        } catch {
          // Ignore fetch failures
        }
      })
    ).then(() => {
      if (!cancelled) setIcons(new Map(ITEM_ICON_CACHE));
    });

    return () => {
      cancelled = true;
    };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return icons;
}

function looksLikeSimcInput(input: string) {
  const text = input.trim();
  if (text.length < 10) return false;

  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const hasChecksum = lines.some((line) => /^#\s*Checksum:/i.test(line));
  const hasSimcKeyValue = lines.some((line) =>
    /^(?:warrior|paladin|hunter|rogue|priest|death_knight|deathknight|shaman|mage|warlock|monk|druid|demon_hunter|demonhunter|evoker|player|name|server|region|spec|talents)\s*=/i.test(
      line
    )
  );
  const hasArmoryLine = lines.some((line) => /^armory\s*=/i.test(line));
  const hasCharacterHeader = lines.some((line) => /^\w+="[^"]+"/.test(line));
  const hasDungeonRoute = lines.some((line) =>
    /^(?:dungeon_route|route|mythic_plus_route|mplus_route|dungeon|instance|keystone_level|mythic_plus_level)\s*=/i.test(
      line
    )
  );

  return hasChecksum || hasArmoryLine || hasSimcKeyValue || hasCharacterHeader || hasDungeonRoute;
}

function splitSimcProfiles(input: string): string[] {
  const profiles: string[] = [];
  const lines = input.split(/\r?\n/);

  let currentProfile: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    currentProfile.push(line);

    if (/^#\s*Checksum:\s*[0-9a-fA-F]+/i.test(line.trim())) {
      profiles.push(currentProfile.join('\n'));
      currentProfile = [];
    }
  }

  if (currentProfile.some((l) => l.trim().length > 0)) {
    profiles.push(currentProfile.join('\n'));
  }

  return profiles.map((p) => p.trim()).filter((p) => p.length > 0 && looksLikeSimcInput(p));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('timeout')), timeoutMs);
    }),
  ]);
}

function normalizeClipboardTextPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object' && 'text' in payload) {
    const text = (payload as { text?: unknown }).text;
    return typeof text === 'string' ? text : '';
  }
  return '';
}

function ClipboardBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="pointer-events-auto w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-emerald-500/25 bg-zinc-950/95 p-4 text-sm text-emerald-100 shadow-2xl shadow-black/40 backdrop-blur-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
          <svg
            className="h-4 w-4"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6.5 8.5l1.5 1.5L11 7" />
            <circle cx="8" cy="8" r="6" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-emerald-100">Clipboard pasted</p>
          <p className="mt-1 text-[13px] leading-5 text-zinc-300">{message}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
          aria-label="Dismiss notification"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function renderSimcLine(line: string) {
  if (!line) return null;

  if (/^\s*#\s*Checksum:/i.test(line)) {
    return <span className="text-amber-300">{line}</span>;
  }
  if (/^\s*#/.test(line)) {
    return <span className="text-zinc-500">{line}</span>;
  }

  const kv = line.match(/^(\s*)([A-Za-z0-9_.-]+)(\s*=\s*)(.*)$/);
  if (!kv) return <span className="text-zinc-300">{line}</span>;

  const [, indent, key, sep, rawValue] = kv;
  const value =
    /^".*"$/.test(rawValue) || /^[A-Za-z_/-]+$/.test(rawValue)
      ? 'text-emerald-300'
      : /^\d+(?:\.\d+)?$/.test(rawValue)
        ? 'text-sky-300'
        : 'text-zinc-300';

  return (
    <>
      <span className="text-zinc-300">{indent}</span>
      <span className="text-gold">{key}</span>
      <span className="text-zinc-500">{sep}</span>
      <span className={value}>{rawValue}</span>
    </>
  );
}

function normalizeClassKey(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/g, '_');
}

function resolveClassColor(className?: string | null): string | undefined {
  if (!className) return undefined;
  const normalized = normalizeClassKey(className);
  return CLASS_COLORS[normalized] || CLASS_COLORS[normalized.replace(/_/g, '')];
}

function formatRealmName(realm?: string | null): string {
  if (!realm) return '';
  return realm.charAt(0).toUpperCase() + realm.slice(1);
}

function SimcInputEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const preRef = useRef<HTMLPreElement | null>(null);
  const editorHeight = expanded ? 'h-[28rem]' : 'h-40';

  const syncScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (!preRef.current) return;
    preRef.current.scrollTop = e.currentTarget.scrollTop;
    preRef.current.scrollLeft = e.currentTarget.scrollLeft;
  };

  const lines = value.split('\n');

  // Shared typography classes to ensure pixel-perfect alignment.
  // We use whitespace-pre to match how most editors handle SimC strings,
  // and explicit line-height to prevent vertical drift.
  const typographyClasses = 'font-mono text-[13px] leading-[1.6] whitespace-pre px-4 py-3';

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      <div className="relative w-full rounded-lg border border-border bg-surface-2 shadow-sm transition-all duration-150 focus-within:border-gold/50 focus-within:ring-2 focus-within:ring-gold/20">
        {/* The highlight layer (Pre) */}
        <pre
          ref={preRef}
          aria-hidden
          className={`pointer-events-none absolute inset-0 ${editorHeight} scrollbar-none w-full overflow-hidden ${typographyClasses}`}
        >
          {value ? (
            lines.map((line, idx) => (
              <span key={idx}>
                {renderSimcLine(line)}
                {idx < lines.length - 1 ? '\n' : null}
              </span>
            ))
          ) : (
            <span className="text-zinc-500 opacity-0">{placeholder}</span>
          )}
        </pre>
        {/* The interactive layer (Textarea) */}
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          placeholder={placeholder}
          spellCheck={false}
          className={`relative block ${editorHeight} w-full resize-none overflow-auto bg-transparent text-transparent placeholder-zinc-500 caret-zinc-100 focus:outline-none ${typographyClasses}`}
        />
      </div>
    </div>
  );
}

const EXPERT_TABS = [
  {
    key: 'header',
    label: 'Header',
    desc: 'Injected before the base actor. Use for global options and initial overrides.',
  },
  {
    key: 'base_player',
    label: 'Base Player',
    desc: 'Injected after the base actor definition. Use for custom APL (actions=...) or player-specific overrides.',
  },
  {
    key: 'raid_actors',
    label: 'Raid Actors',
    desc: 'Extremely experimental! Adds additional raid actors. Disables single_actor_batch when used.',
  },
  {
    key: 'post_combos',
    label: 'Post Combos',
    desc: 'Injected after all profileset combinations. Use for additional actors after gear combos.',
  },
  {
    key: 'footer',
    label: 'Footer',
    desc: 'Injected at the very end. Use for dungeon routes, fight overrides, or custom enemy configs.',
  },
] as const;

type ExpertTabKey = (typeof EXPERT_TABS)[number]['key'];

function CharacterInfoBar({
  info,
}: {
  info: {
    className: string;
    name: string;
    spec: string;
    level: string | null;
    race: string | null;
    region: string | null;
    server: string | null;
    role: string | null;
    professions: string | null;
    lootSpec: string | null;
    addonVersion: string | null;
    wowVersion: string | null;
    requiresVersion: string | null;
    talentsCount: number;
    savedLoadouts: number;
    checksum: string | null;
  };
}) {
  const [expanded, setExpanded] = useState(false);
  const profileUrl =
    info.region && info.server && info.name
      ? `/character/${info.region.toLowerCase()}/${info.server
          .toLowerCase()
          .replace(/'/g, '')
          .replace(/\s+/g, '-')}/${info.name.toLowerCase()}`
      : null;

  const classColor = CLASS_COLORS[info.className.toLowerCase().replace(/\s+/g, '')] || '#fff';

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-white/5 bg-white/[0.03] transition-all hover:border-white/10 hover:bg-white/[0.05]">
      <div className="flex items-center justify-between gap-4 p-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-[10px] font-bold uppercase tracking-tighter shadow-inner"
            style={{ color: classColor }}
          >
            {info.spec.slice(0, 3)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-[15px] font-bold tracking-tight text-white">
                {info.name}
              </span>
              {info.level && (
                <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-500">
                  L{info.level}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 truncate text-[12px] font-medium">
              <span style={{ color: classColor }}>{specDisplayName(info.spec)}</span>
              <span className="text-zinc-500">{info.className}</span>
              <span className="mx-0.5 h-1 w-1 rounded-full bg-zinc-700" />
              <span className="text-zinc-400">
                {info.region?.toUpperCase()}·{info.server}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {profileUrl && (
            <Link
              href={profileUrl}
              className="hidden rounded-lg bg-gold/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-gold transition-all hover:bg-gold/20 sm:block"
            >
              Profile
            </Link>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={`rounded-lg p-2 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white ${expanded ? 'bg-white/5 text-white' : ''}`}
          >
            <svg
              className={`h-4 w-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-white/5 bg-black/20 px-4 py-2 text-[11px] font-medium">
        {info.role && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600">
              Role
            </span>
            <span className="text-zinc-300">{info.role}</span>
          </div>
        )}
        {info.race && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600">
              Race
            </span>
            <span className="text-zinc-300">{info.race}</span>
          </div>
        )}
        {info.lootSpec && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600">
              Loot
            </span>
            <span className="text-zinc-300">{info.lootSpec}</span>
          </div>
        )}
      </div>

      {expanded && (
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 border-t border-white/5 bg-black/40 p-4">
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">
                Addon Info
              </p>
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between border-b border-white/[0.03] pb-1">
                  <span className="text-zinc-500">Version</span>
                  <span className="text-zinc-300">{info.addonVersion || 'Unknown'}</span>
                </div>
                <div className="flex justify-between border-b border-white/[0.03] pb-1">
                  <span className="text-zinc-500">WoW Version</span>
                  <span className="text-zinc-300">{info.wowVersion || 'Unknown'}</span>
                </div>
              </div>
            </div>
            <div>
              <p className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">
                Sim Info
              </p>
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between border-b border-white/[0.03] pb-1">
                  <span className="text-zinc-500">Talent Blocks</span>
                  <span className="text-zinc-300">{info.talentsCount}</span>
                </div>
                <div className="flex justify-between border-b border-white/[0.03] pb-1">
                  <span className="text-zinc-500">Saved Loadouts</span>
                  <span className="text-zinc-300">{info.savedLoadouts}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {info.professions && (
              <div>
                <p className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">
                  Professions
                </p>
                <p className="text-[11px] leading-relaxed text-zinc-300">{info.professions}</p>
              </div>
            )}
            {info.checksum && (
              <div>
                <p className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">
                  Verification
                </p>
                <div className="rounded border border-emerald-500/10 bg-emerald-500/5 px-2 py-1 font-mono text-[10px] text-emerald-400/80">
                  {info.checksum}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DungeonInfoBar({
  info,
  onSave,
  onViewDetails,
  isSaving,
  isAlreadySaved,
}: {
  info: {
    title: string;
    dungeon: string | null;
    level: string | null;
    maxTime: string | null;
    pullCount: number | null;
    pulls: PullInfo[];
    extras: string[];
  };
  onSave?: () => void;
  onViewDetails?: () => void;
  isSaving?: boolean;
  isAlreadySaved?: boolean;
}) {
  const hasBloodlust = info.pulls.some((p) => p.bloodlust);

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-white/5 bg-white/[0.03] transition-all hover:border-white/10 hover:bg-white/[0.05]">
      <div className="flex items-center gap-3 p-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-sky-500/10 bg-sky-500/5 text-sky-400 shadow-inner">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L16 4m0 13V4m0 0L9 7"
            />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="truncate text-[15px] font-bold tracking-tight text-white">
                {info.dungeon || 'Unknown Dungeon'}
              </span>
              {info.level && (
                <span className="shrink-0 rounded bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] font-black text-sky-400">
                  +{info.level}
                </span>
              )}
              {hasBloodlust && (
                <span
                  className="shrink-0 rounded bg-red-500/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-red-400"
                  title="Route includes Bloodlust/Heroism"
                >
                  BL
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onViewDetails?.();
                }}
                className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-bold text-zinc-300 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white"
              >
                View Details
              </button>
              {onSave && (
                <button
                  onClick={onSave}
                  disabled={isSaving || isAlreadySaved}
                  className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-bold transition-all ${
                    isAlreadySaved
                      ? 'cursor-default border-emerald-500/20 bg-emerald-500/5 text-emerald-400/80'
                      : 'border-white/10 bg-white/5 text-zinc-300 hover:border-white/20 hover:bg-white/10 hover:text-white disabled:opacity-50'
                  }`}
                >
                  {isSaving ? (
                    <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  ) : isAlreadySaved ? (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
                      />
                    </svg>
                  )}
                  {isAlreadySaved ? 'Saved' : 'Save Route'}
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 truncate text-[12px] font-medium text-zinc-500">
            <span>{info.title}</span>
            {info.maxTime && (
              <>
                <span className="mx-0.5 h-1 w-1 rounded-full bg-zinc-700" />
                <span className="flex items-center gap-1">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  {Math.round(Number(info.maxTime) / 60)}m
                </span>
              </>
            )}
            {info.pullCount && (
              <>
                <span className="mx-0.5 h-1 w-1 rounded-full bg-zinc-700" />
                <span>{info.pullCount} Pulls</span>
              </>
            )}
          </div>
        </div>
      </div>

      {info.extras.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-white/5 bg-black/20 px-4 py-2">
          {info.extras.map((extra) => (
            <span
              key={extra}
              className="text-[10px] font-bold uppercase tracking-wider text-zinc-500"
            >
              {extra}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function optionQualityFamily(opt: OptionEntry | null) {
  const token = (opt?.token || opt?.key || '').replace(/^main_hand:/, '');
  return token.replace(/_[1-3]$/i, '');
}

function remapQuality(quality: number | undefined, familyMax: number | undefined) {
  if (!quality || quality < 1 || quality > 3) return undefined;
  // 2-tier groups: 1=silver, 2=gold
  if (familyMax === 2) {
    if (quality === 1) return 2;
    if (quality === 2) return 3;
  }
  // 3-tier groups: 1=bronze, 2=silver, 3=gold
  return quality;
}

function optionSelectLabel(opt: OptionEntry) {
  return (opt.label || '')
    .replace(/\s*\(Quality\s*[1-3]\)\s*$/i, '')
    .replace(/\s+[1-3]\s*$/i, '')
    .replace(/\s*\((Gold|Silver|Bronze|Tier \d+)\)\s*$/i, '');
}

function QualityBadge({ quality }: { quality?: number }) {
  if (!quality || quality < 1 || quality > 3) return null;
  const tierName = quality === 3 ? 'Gold' : quality === 2 ? 'Silver' : 'Bronze';
  const style =
    quality === 3
      ? 'border-amber-300/60 bg-amber-500 shadow-[0_0_8px_rgba(251,191,36,0.3)]'
      : quality === 2
        ? 'border-zinc-300/60 bg-zinc-400 shadow-[0_0_8px_rgba(161,161,170,0.3)]'
        : 'border-orange-400/60 bg-orange-600 shadow-[0_0_8px_rgba(234,88,12,0.3)]';
  return (
    <span
      className={`h-3 w-3 shrink-0 rounded-[2px] border ${style}`}
      title={`Quality: ${tierName}`}
      aria-label={`Quality: ${tierName}`}
    />
  );
}

function ConsumableSelect({
  label,
  value,
  onChange,
  options,
  qualityMaxByFamily,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: OptionEntry[];
  qualityMaxByFamily: Map<string, number>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useWowheadTooltips([open, value, options.length]);

  const itemIds = useMemo(() => {
    return options.map((o) => o.itemId).filter((id): id is number => !!id);
  }, [options]);
  const itemIcons = useItemIcons(itemIds);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const selected = options.find((opt) => (opt.token || '') === value) || null;
  const selectedQuality = remapQuality(
    selected?.craftingQuality,
    qualityMaxByFamily.get(optionQualityFamily(selected))
  );

  const groups = useMemo(() => {
    const map = new Map<
      string,
      { label: string; icon: string; itemId?: number; items: OptionEntry[]; familyMax: number }
    >();
    for (const opt of options) {
      const family = optionQualityFamily(opt);
      if (!map.has(family)) {
        const icon = (opt.itemId && itemIcons.get(opt.itemId)) || opt.icon || '';
        map.set(family, {
          label: optionSelectLabel(opt),
          icon,
          itemId: opt.itemId,
          items: [],
          familyMax: qualityMaxByFamily.get(family) || 0,
        });
      }
      map.get(family)!.items.push(opt);
    }
    return Array.from(map.values());
  }, [options, qualityMaxByFamily, itemIcons]);

  return (
    <div className="space-y-1.5 text-[13px] text-zinc-300">
      <span className="block">{label}</span>
      <div ref={rootRef} className="relative">
        <div
          role="button"
          tabIndex={0}
          onClick={() => !disabled && setOpen((v) => !v)}
          className={`flex w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-left text-sm ${
            disabled
              ? 'cursor-not-allowed text-zinc-500 opacity-70'
              : 'cursor-pointer text-zinc-200'
          }`}
        >
          {selected?.icon || (selected?.itemId && itemIcons.get(selected.itemId)) ? (
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              data-wowhead={
                selected.itemId
                  ? `item=${selected.itemId}`
                  : selected.spellId
                    ? `spell=${selected.spellId}`
                    : undefined
              }
              className="flex shrink-0 items-center"
            >
              <img
                src={`https://wow.zamimg.com/images/wow/icons/small/${
                  (selected.itemId && itemIcons.get(selected.itemId)) || selected.icon
                }.jpg`}
                alt=""
                className="h-4 w-4 shrink-0 rounded-[3px]"
              />
            </a>
          ) : (
            <span className="h-4 w-4 shrink-0 rounded-[3px] border border-border bg-surface-2" />
          )}
          <a
            href="#"
            onClick={(e) => e.preventDefault()}
            className="flex min-w-0 items-center gap-1.5"
            data-wowhead={
              selected?.itemId
                ? `item=${selected.itemId}`
                : selected?.spellId
                  ? `spell=${selected.spellId}`
                  : undefined
            }
          >
            <span className="truncate">{selected ? optionSelectLabel(selected) : 'None'}</span>
            <QualityBadge quality={selectedQuality} />
          </a>
          <svg
            className={`ml-auto h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </div>
        {open && (
          <div className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-xl">
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-left text-sm text-zinc-300 hover:bg-white/[0.04]"
            >
              <span className="h-4 w-4 shrink-0 rounded-[3px] border border-border bg-surface-2" />
              <span className="truncate">None</span>
            </button>
            <div className="my-1 h-px bg-border/50" />
            {groups.map((group) => {
              const hasQuality = group.familyMax > 0;
              const isSelectedFamily =
                selected && optionQualityFamily(selected) === optionQualityFamily(group.items[0]);

              return (
                <div
                  key={group.label}
                  className={`flex items-center justify-between gap-2 rounded px-2.5 py-2 text-sm transition-colors ${
                    !hasQuality ? 'cursor-pointer hover:bg-white/[0.04]' : ''
                  } ${isSelectedFamily && !hasQuality ? 'bg-gold/[0.08] text-white' : 'text-zinc-300'}`}
                  onClick={() => {
                    if (!hasQuality) {
                      onChange(group.items[0].token || '');
                      setOpen(false);
                    }
                  }}
                >
                  <a
                    href="#"
                    onClick={(e) => {
                      if (!hasQuality) {
                        e.preventDefault();
                      }
                    }}
                    data-wowhead={
                      group.itemId
                        ? `item=${group.itemId}`
                        : group.items[0]?.spellId
                          ? `spell=${group.items[0].spellId}`
                          : undefined
                    }
                    className="flex min-w-0 flex-1 items-center gap-2 no-underline hover:no-underline"
                  >
                    <img
                      src={`https://wow.zamimg.com/images/wow/icons/small/${group.icon}.jpg`}
                      alt=""
                      className="h-4 w-4 shrink-0 rounded-[3px]"
                    />
                    <span className="truncate">{group.label}</span>
                  </a>
                  {hasQuality && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      {group.items
                        .sort((a, b) => (a.craftingQuality || 0) - (b.craftingQuality || 0))
                        .map((opt) => {
                          const q = remapQuality(opt.craftingQuality, group.familyMax);
                          const isOptSelected = value === opt.token;
                          const qStyle =
                            q === 3
                              ? isOptSelected
                                ? 'border-amber-300/60 bg-amber-500 shadow-[0_0_8px_rgba(251,191,36,0.3)]'
                                : 'border-amber-300/30 bg-amber-500/10 hover:border-amber-300/60 hover:bg-amber-500/20'
                              : q === 2
                                ? isOptSelected
                                  ? 'border-zinc-300/60 bg-zinc-400 shadow-[0_0_8px_rgba(161,161,170,0.3)]'
                                  : 'border-zinc-300/30 bg-zinc-400/10 hover:border-zinc-300/60 hover:bg-zinc-400/20'
                                : isOptSelected
                                  ? 'border-orange-400/60 bg-orange-600 shadow-[0_0_8px_rgba(234,88,12,0.3)]'
                                  : 'border-orange-400/30 bg-orange-600/10 hover:border-orange-400/60 hover:bg-orange-600/20';

                          const qName = q === 3 ? 'Gold' : q === 2 ? 'Silver' : 'Bronze';

                          return (
                            <a
                              key={opt.key}
                              href="#"
                              title={`Quality: ${qName}`}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onChange(opt.token || '');
                                setOpen(false);
                              }}
                              data-wowhead={
                                opt.itemId
                                  ? `item=${opt.itemId}`
                                  : opt.spellId
                                    ? `spell=${opt.spellId}`
                                    : undefined
                              }
                              className={`block h-3.5 w-3.5 rounded-[2px] border transition-all ${qStyle}`}
                            />
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function FightSetupOptions() {
  const { fightStyle, setFightStyle, targetCount, setTargetCount, fightLength, setFightLength } =
    useSimContext();
  const fightStyleRules = getFightStyleParamRules(fightStyle);
  const showFightLength = fightStyleRules.usesFightLength;
  const showTargetCount = fightStyleRules.usesTargetCount;

  return (
    <div className="card space-y-4 p-5">
      <div>
        <p className="text-[15px] font-medium text-zinc-100">Fight Setup</p>
        <p className="text-[14px] text-zinc-300">
          Configure fight style and scenario variants together.
        </p>
      </div>

      <div
        className={`grid gap-4 ${
          showFightLength && showTargetCount
            ? 'grid-cols-3'
            : showFightLength || showTargetCount
              ? 'grid-cols-2'
              : 'grid-cols-1'
        }`}
      >
        <div className="space-y-2">
          <label className="label-text">Fight Style</label>
          <FightStyleSelector value={fightStyle} onChange={setFightStyle} />
        </div>

        {showFightLength && (
          <div className="space-y-2">
            <label className="label-text">Fight Length</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={30}
                max={600}
                step={30}
                value={fightLength}
                onChange={(e) => setFightLength(Number(e.target.value))}
                className="flex-1 accent-gold"
              />
              <span className="w-16 text-right font-mono text-sm tabular-nums text-white">
                {Math.floor(fightLength / 60)}:{String(fightLength % 60).padStart(2, '0')}
              </span>
            </div>
          </div>
        )}

        {showTargetCount && (
          <div className="space-y-2">
            <label className="label-text">Number of Bosses</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={10}
                value={targetCount}
                onChange={(e) => setTargetCount(Number(e.target.value))}
                className="flex-1 accent-gold"
              />
              <span className="w-6 text-right font-mono text-sm tabular-nums text-white">
                {targetCount}
              </span>
            </div>
          </div>
        )}

        {!showFightLength && !showTargetCount && (
          <div className="text-[14px] text-zinc-300">
            This fight style uses built-in timing and target scripting.
          </div>
        )}
      </div>

      <ScenarioBuilder />
    </div>
  );
}

function ConsumablesAndRaidBuffsOptions() {
  const {
    simcChannel,
    setSimcChannel,
    externalBuffChaosBrand,
    setExternalBuffChaosBrand,
    externalBuffMysticTouch,
    setExternalBuffMysticTouch,
    externalBuffSkyfury,
    setExternalBuffSkyfury,
    externalBuffPowerInfusion,
    setExternalBuffPowerInfusion,
    raidBuffBloodlust,
    setRaidBuffBloodlust,
    raidBuffArcaneIntellect,
    setRaidBuffArcaneIntellect,
    raidBuffPowerWordFortitude,
    setRaidBuffPowerWordFortitude,
    raidBuffMarkOfTheWild,
    setRaidBuffMarkOfTheWild,
    raidBuffBattleShout,
    setRaidBuffBattleShout,
    raidBuffHuntersMark,
    setRaidBuffHuntersMark,
    raidBuffBleeding,
    setRaidBuffBleeding,
    consumableFlask,
    setConsumableFlask,
    consumableFood,
    setConsumableFood,
    consumablePotion,
    setConsumablePotion,
    consumableAugmentation,
    setConsumableAugmentation,
    consumableTemporaryEnchant,
    setConsumableTemporaryEnchant,
    lockSingleConsumableOptions,
  } = useSimContext();
  const [installedSimcChannels, setInstalledSimcChannels] = useState<string[]>(['nightly']);

  const { flasks, foods, potions, augments, tempEnchants } = useConsumableOptions(11);
  const qualityMaxByFamily = useMemo(() => {
    const map = new Map<string, number>();
    const all = [...flasks, ...potions, ...augments, ...tempEnchants];
    for (const opt of all) {
      const family = optionQualityFamily(opt);
      const q = opt.craftingQuality || 0;
      map.set(family, Math.max(map.get(family) || 0, q));
    }
    return map;
  }, [flasks, potions, augments, tempEnchants]);
  const refreshInstalledSimcChannels = useCallback(async () => {
    if (!isDesktop) {
      setInstalledSimcChannels(['nightly']);
      return;
    }
    try {
      const nightly = await getSimcStatus();
      const installed = [nightly.installed_exists ? 'nightly' : null].filter(Boolean) as string[];
      setInstalledSimcChannels(installed.length > 0 ? installed : ['nightly']);
    } catch {
      setInstalledSimcChannels(['nightly']);
    }
  }, []);

  useEffect(() => {
    void refreshInstalledSimcChannels();
  }, [refreshInstalledSimcChannels]);

  useEffect(() => {
    if (!installedSimcChannels.includes(simcChannel)) {
      setSimcChannel(installedSimcChannels[0] || 'nightly');
    }
  }, [installedSimcChannels, setSimcChannel, simcChannel]);
  const raidBuffIcons = useSpellIcons(RAID_BUFF_MATRIX_OPTIONS.map((buff) => buff.spellId || 0));

  const raidBuffBindings: Record<string, { checked: boolean; setChecked: (v: boolean) => void }> = {
    bloodlust: { checked: raidBuffBloodlust, setChecked: setRaidBuffBloodlust },
    arcane_intellect: { checked: raidBuffArcaneIntellect, setChecked: setRaidBuffArcaneIntellect },
    power_word_fortitude: {
      checked: raidBuffPowerWordFortitude,
      setChecked: setRaidBuffPowerWordFortitude,
    },
    mark_of_the_wild: { checked: raidBuffMarkOfTheWild, setChecked: setRaidBuffMarkOfTheWild },
    battle_shout: { checked: raidBuffBattleShout, setChecked: setRaidBuffBattleShout },
    hunters_mark: { checked: raidBuffHuntersMark, setChecked: setRaidBuffHuntersMark },
    bleeding: { checked: raidBuffBleeding, setChecked: setRaidBuffBleeding },
    mystic_touch: { checked: externalBuffMysticTouch, setChecked: setExternalBuffMysticTouch },
    chaos_brand: { checked: externalBuffChaosBrand, setChecked: setExternalBuffChaosBrand },
    skyfury: { checked: externalBuffSkyfury, setChecked: setExternalBuffSkyfury },
    power_infusion: {
      checked: externalBuffPowerInfusion,
      setChecked: setExternalBuffPowerInfusion,
    },
  };

  useWowheadTooltips([
    externalBuffChaosBrand,
    externalBuffMysticTouch,
    externalBuffSkyfury,
    externalBuffPowerInfusion,
    raidBuffBloodlust,
    raidBuffArcaneIntellect,
    raidBuffPowerWordFortitude,
    raidBuffMarkOfTheWild,
    raidBuffBattleShout,
    raidBuffHuntersMark,
    raidBuffBleeding,
    consumableFlask,
    consumablePotion,
    consumableAugmentation,
    consumableTemporaryEnchant,
    consumableFood,
  ]);

  if (lockSingleConsumableOptions) {
    return null;
  }

  return (
    <div className="card space-y-5 p-5">
      <div>
        <p className="text-[15px] font-medium text-zinc-100">Consumables &amp; Raid Buffs</p>
        <p className="text-[14px] text-zinc-300">
          Manage consumable picks and raid buff assumptions outside of Advanced Options.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-border/70 bg-surface-2/70 p-3.5">
        <div>
          <p className="text-[15px] font-medium text-zinc-100">Consumables</p>
          <p className="text-[14px] text-zinc-300">
            Select one per category for normal sims. Use Stat Weights matrix to compare many at
            once.
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-zinc-300">
              Flask
            </p>
            <ConsumableSelect
              label="Active Flask"
              value={consumableFlask}
              onChange={setConsumableFlask}
              options={flasks}
              qualityMaxByFamily={qualityMaxByFamily}
              disabled={lockSingleConsumableOptions}
            />
          </div>

          <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-zinc-300">
              Potion
            </p>
            <ConsumableSelect
              label="Active Potion"
              value={consumablePotion}
              onChange={setConsumablePotion}
              options={potions}
              qualityMaxByFamily={qualityMaxByFamily}
              disabled={lockSingleConsumableOptions}
            />
          </div>

          <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-zinc-300">
              Augmentation Rune
            </p>
            <ConsumableSelect
              label="Active Augmentation Rune"
              value={consumableAugmentation}
              onChange={setConsumableAugmentation}
              options={augments}
              qualityMaxByFamily={qualityMaxByFamily}
              disabled={lockSingleConsumableOptions}
            />
          </div>

          <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-zinc-300">
              Temporary Enchant
            </p>
            <ConsumableSelect
              label="Main Hand Temporary Enchant"
              value={consumableTemporaryEnchant}
              onChange={setConsumableTemporaryEnchant}
              options={tempEnchants}
              qualityMaxByFamily={qualityMaxByFamily}
              disabled={lockSingleConsumableOptions}
            />
          </div>

          <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-zinc-300">Food</p>
            <ConsumableSelect
              label="Active Food Buff"
              value={consumableFood}
              onChange={setConsumableFood}
              options={foods}
              qualityMaxByFamily={qualityMaxByFamily}
              disabled={lockSingleConsumableOptions}
            />
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border/70 bg-surface-2/70 p-3.5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[15px] font-medium text-zinc-100">Raid Buffs</p>
            <p className="text-[14px] text-zinc-300">Control default raid buffs for normal sims.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                Object.values(raidBuffBindings).forEach((b) => b.setChecked(true));
              }}
              className="rounded-md border border-gold/45 bg-gold/[0.12] px-2.5 py-1 text-[12px] font-semibold text-gold transition-colors hover:bg-gold/[0.2]"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={() => {
                Object.values(raidBuffBindings).forEach((b) => b.setChecked(false));
              }}
              className="rounded-md border border-zinc-600 bg-zinc-900/70 px-2.5 py-1 text-[12px] font-semibold text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {RAID_BUFF_MATRIX_OPTIONS.map((buff) => {
            const binding = raidBuffBindings[buff.key] || {
              checked: false,
              setChecked: (_: boolean) => {},
            };
            return (
              <label
                key={buff.key}
                className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 transition-colors ${
                  binding.checked
                    ? 'border-gold/40 bg-gold/[0.08]'
                    : 'border-border bg-surface hover:border-zinc-600'
                }`}
              >
                <a
                  href={`https://www.wowhead.com/spell=${buff.spellId}`}
                  target="_blank"
                  rel="noreferrer"
                  data-wowhead={`spell=${buff.spellId}`}
                  className="flex min-w-0 items-center gap-2 text-zinc-100 hover:text-white"
                  onClick={(e) => e.stopPropagation()}
                >
                  <img
                    src={`https://wow.zamimg.com/images/wow/icons/small/${
                      raidBuffIcons.get(buff.spellId || 0) || buff.icon
                    }.jpg`}
                    onError={(e) => {
                      const img = e.currentTarget;
                      if (img.dataset.fallbackApplied === '1') return;
                      img.dataset.fallbackApplied = '1';
                      img.src = `https://wow.zamimg.com/images/wow/icons/small/${buff.icon}.jpg`;
                    }}
                    alt=""
                    className="h-4 w-4 shrink-0 rounded-[3px]"
                  />
                  <span className="truncate text-[14px]">{buff.label}</span>
                </a>
                <input
                  type="checkbox"
                  checked={binding.checked}
                  onChange={(e) => binding.setChecked(e.target.checked)}
                  className="h-4 w-4 accent-gold"
                />
              </label>
            );
          })}
        </div>
        <p className="text-[12px] text-zinc-300">
          If your character provides one of these buffs, SimC may still include it.
        </p>
      </div>
    </div>
  );
}

function AdvancedOptions() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ExpertTabKey>('footer');
  const {
    customApl,
    setCustomApl,
    includeTimeline,
    setIncludeTimeline,
    simcHeader,
    setSimcHeader,
    simcBasePlayer,
    setSimcBasePlayer,
    simcRaidActors,
    setSimcRaidActors,
    simcPostCombos,
    setSimcPostCombos,
    simcFooter,
    setSimcFooter,
  } = useSimContext();

  const expertValues: Record<ExpertTabKey, string> = useMemo(
    () => ({
      header: simcHeader,
      base_player: simcBasePlayer,
      raid_actors: simcRaidActors,
      post_combos: simcPostCombos,
      footer: simcFooter,
    }),
    [simcHeader, simcBasePlayer, simcRaidActors, simcPostCombos, simcFooter]
  );

  const expertSetters: Record<ExpertTabKey, (v: string) => void> = useMemo(
    () => ({
      header: setSimcHeader,
      base_player: setSimcBasePlayer,
      raid_actors: setSimcRaidActors,
      post_combos: setSimcPostCombos,
      footer: setSimcFooter,
    }),
    [setSimcHeader, setSimcBasePlayer, setSimcRaidActors, setSimcPostCombos, setSimcFooter]
  );

  const hasExpertContent = Object.values(expertValues).some((v) => v.trim());
  const isDefault = includeTimeline && !customApl && !hasExpertContent;
  const activeTabInfo = EXPERT_TABS.find((t) => t.key === activeTab)!;

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-3.5 transition-colors hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-2.5">
          <svg
            className="h-4 w-4 text-zinc-400"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="8" cy="8" r="2" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
          </svg>
          <span className="text-[15px] font-medium text-zinc-100">Advanced Options</span>
          {!open && !isDefault && (
            <span className="rounded-md bg-gold/10 px-1.5 py-0.5 text-[12px] font-medium text-gold">
              Modified
            </span>
          )}
        </div>
        <svg
          className={`h-3.5 w-3.5 text-zinc-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="animate-fade-in space-y-5 border-t border-border px-5 pb-5">
          <div className="pt-4" />

          {/* Custom APL */}
          <div className="space-y-2">
            <label className="label-text">Custom APL / SimC Options</label>
            <textarea
              value={customApl}
              onChange={(e) => setCustomApl(e.target.value)}
              placeholder="Custom APL or expansion options (e.g., actions=..., midnight.*, use_blizzard_action_list=1)..."
              className="input-field h-28 resize-y font-mono text-[14px] leading-relaxed"
            />
            <p className="text-[14px] text-zinc-300">
              Override action priority lists or set expansion-specific options. Injected after the
              base actor.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/70 bg-surface-2/70 px-3.5 py-2.5">
            <div>
              <p className="text-[15px] font-medium text-zinc-100">Timeline &amp; APL Analyzer</p>
              <p className="text-[14px] text-zinc-300">
                Include action sequence, cooldown timing, and buff uptime data in sim results.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIncludeTimeline(!includeTimeline)}
              className={`relative h-5 w-9 rounded-full transition-colors ${
                includeTimeline ? 'bg-gold' : 'border border-border bg-surface'
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
                  includeTimeline ? 'left-[18px] bg-black' : 'left-0.5 bg-gray-500'
                }`}
              />
            </button>
          </div>

          {/* Expert Mode */}
          <ExpertToggle
            hasContent={hasExpertContent}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            expertValues={expertValues}
            expertSetters={expertSetters}
            activeTabInfo={activeTabInfo}
          />
        </div>
      )}
    </div>
  );
}

function ExpertToggle({
  hasContent,
  activeTab,
  setActiveTab,
  expertValues,
  expertSetters,
  activeTabInfo,
}: {
  hasContent: boolean;
  activeTab: ExpertTabKey;
  setActiveTab: (v: ExpertTabKey) => void;
  expertValues: Record<ExpertTabKey, string>;
  expertSetters: Record<ExpertTabKey, (v: string) => void>;
  activeTabInfo: (typeof EXPERT_TABS)[number];
}) {
  const [open, setOpen] = useState(hasContent);

  return (
    <div className="space-y-3 border-t border-border/60 pt-3">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-2.5">
        <div
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
            open ? 'bg-gold' : 'border border-border bg-surface-2'
          }`}
        >
          <div
            className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
              open ? 'left-[18px] bg-black' : 'left-0.5 bg-gray-500'
            }`}
          />
        </div>
        <span className="text-[15px] font-medium text-zinc-100">Expert Mode</span>
        {!open && hasContent && (
          <span className="rounded-md bg-gold/10 px-1.5 py-0.5 text-xs font-medium text-gold">
            Modified
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-3">
          <div className="flex gap-1 overflow-x-auto">
            {EXPERT_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-all duration-150 ${
                  activeTab === tab.key
                    ? 'border-gold/40 bg-gold/[0.08] text-gold'
                    : expertValues[tab.key].trim()
                      ? 'border-gold/30 bg-gold/[0.06] text-gold hover:border-gold/50'
                      : 'border-border bg-surface-2 text-zinc-200 hover:border-zinc-500 hover:text-white'
                }`}
              >
                {tab.label}
                {expertValues[tab.key].trim() && activeTab !== tab.key && (
                  <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-gold" />
                )}
              </button>
            ))}
          </div>
          <textarea
            value={expertValues[activeTab]}
            onChange={(e) => expertSetters[activeTab](e.target.value)}
            placeholder={`Paste ${activeTabInfo.label.toLowerCase()} SimC input here...`}
            className="input-field h-32 resize-y font-mono text-[14px] leading-relaxed"
          />
          <p className="text-[14px] text-zinc-200">{activeTabInfo.desc}</p>
        </div>
      )}
    </div>
  );
}

function RouteSelectorModal({
  isOpen,
  onClose,
  routes,
  onSelect,
  onDelete,
}: {
  isOpen: boolean;
  onClose: () => void;
  routes: SavedRoute[];
  onSelect: (route: SavedRoute) => void;
  onDelete: (id: string) => void;
}) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutside(modalRef, isOpen, onClose);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div ref={modalRef} className="relative flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/5 p-4">
          <div className="flex items-center gap-2">
            <svg
              className="h-5 w-5 text-sky-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
              />
            </svg>
            <h2 className="text-lg font-bold text-white">Select Saved Route</h2>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {routes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
              <p>No saved routes yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {routes.map((route) => (
                <div
                  key={route.id}
                  className="group relative flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3 transition-all hover:border-white/10 hover:bg-white/[0.05]"
                >
                  <button
                    onClick={() => {
                      onSelect(route);
                      onClose();
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[14px] font-bold text-zinc-200 transition-colors group-hover:text-sky-400">
                        {route.name}
                      </span>
                    </div>
                    <div className="text-[12px] font-medium text-zinc-500">{route.dungeon}</div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(route.id);
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-600 transition-all hover:bg-red-500/10 hover:text-red-400"
                    title="Delete saved route"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SimSharedConfig() {
  const pathname = usePathname();
  const { simcInput, setSimcInput, simcFooter, setSimcFooter, autoClipboardPasteSimc } =
    useSimContext();
  const checksumStatus = useMemo(() => validateChecksum(simcInput), [simcInput]);

  const detectedCharacterInfo = useMemo(() => {
    const info = parseCharacterInfo(simcInput);
    return info?.kind === 'character' ? info : null;
  }, [simcInput]);
  const detectedDungeonInfo = useMemo(() => {
    const info = parseCharacterInfo(simcFooter);
    return info?.kind === 'dungeon' ? info : null;
  }, [simcFooter]);
  const [banner, setBanner] = useState<{ text: string; id: number } | null>(null);
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [isSavingRoute, setIsSavingRoute] = useState(false);
  const [isRouteModalOpen, setIsRouteModalOpen] = useState(false);
  const [viewingDungeonRoute, setViewingDungeonRoute] = useState<SavedRoute | null>(null);
  const [simcInputHistory, setSimcInputHistory] = useState<string[]>([]);
  const [selectedHistoryIdx, setSelectedHistoryIdx] = useState<number | null>(null);
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null);
  const [historyDropdownOpen, setHistoryDropdownOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState<'saved' | 'history'>('saved');
  const [bnetProfiles, setBnetProfiles] = useState<SavedCharacterProfile[]>([]);
  const [deleteProfileId, setDeleteProfileId] = useState<string | null>(null);
  const historyDropdownRef = useRef<HTMLDivElement | null>(null);

  const deleteTargetProfile = useMemo(
    () => bnetProfiles.find((p) => p.id === deleteProfileId) || null,
    [bnetProfiles, deleteProfileId]
  );
  useDismissOnOutside(historyDropdownRef, historyDropdownOpen, () => setHistoryDropdownOpen(false));

  const addToHistory = useCallback((value: string) => {
    if (!value || value.length < 50) return;

    // Find existing entry by character name (compute before setState)
    const info = parseCharacterInfo(value);
    const charName = info?.kind === 'character' ? info.name : null;

    setSimcInputHistory((prev) => {
      let existingIdx = -1;

      if (charName) {
        existingIdx = prev.findIndex((p) => {
          const existingInfo = parseCharacterInfo(p);
          return existingInfo?.kind === 'character' && existingInfo.name === charName;
        });
      }

      if (existingIdx !== -1) {
        // Update existing entry
        const newHistory = [...prev];
        newHistory[existingIdx] = value;
        return newHistory;
      }

      // Add new entry
      const newHistory = [...prev, value];
      return newHistory.slice(-20);
    });
  }, []);

  // Helper to add to history and return index (for selection)
  const addToHistoryWithSelection = useCallback(
    (value: string): number | null => {
      if (!value || value.length < 50) return null;

      const info = parseCharacterInfo(value);
      const charName = info?.kind === 'character' ? info.name : null;

      // Get current history to find index
      let existingIdx = -1;
      if (charName) {
        existingIdx = simcInputHistory.findIndex((p) => {
          const hInfo = parseCharacterInfo(p);
          return hInfo?.kind === 'character' && hInfo.name === charName;
        });
      }

      const newIdx = existingIdx >= 0 ? existingIdx : simcInputHistory.length;
      addToHistory(value);
      return newIdx;
    },
    [addToHistory, simcInputHistory],
  );

  // Wrap setSimcInput to also track history
  const handleSetSimcInput = useCallback(
    (value: string) => {
      setSimcInput(value);
      if (!value || value.length < 50) {
        setSelectedHistoryIdx(null);
        return;
      }

      // Add to history and get the selected index
      const newIdx = addToHistoryWithSelection(value);
      setSelectedHistoryIdx(newIdx);
    },
    [setSimcInput, addToHistoryWithSelection],
  );

  const isRouteAlreadySaved = useMemo(() => {
    if (!simcFooter || !savedRoutes.length) return false;
    const normalizedCurrent = simcFooter.trim();
    return savedRoutes.some((r) => r.route_data.trim() === normalizedCurrent);
  }, [simcFooter, savedRoutes]);

  const refreshRoutes = useCallback(async () => {
    try {
      const routes = await listSavedRoutes();
      setSavedRoutes(routes);
    } catch (e) {
      console.error('Failed to list saved routes:', e);
    }
  }, []);

  useEffect(() => {
    refreshRoutes();
  }, [refreshRoutes]);

  // Load BNet character profiles when dropdown opens or when tab changes to saved
  useEffect(() => {
    if (!historyDropdownOpen || historyTab !== 'saved') return;
    listCharacterProfiles()
      .then(setBnetProfiles)
      .catch(() => setBnetProfiles([]));
  }, [historyDropdownOpen, historyTab]);

  // Refresh profiles when dropdown is already open (realtime update)
  const refreshProfiles = useCallback(() => {
    if (!historyDropdownOpen || historyTab !== 'saved') return;
    listCharacterProfiles()
      .then(setBnetProfiles)
      .catch(() => setBnetProfiles([]));
  }, [historyDropdownOpen, historyTab]);

  useEffect(() => {
    if (!historyDropdownOpen || historyTab !== 'saved') return;
    const interval = setInterval(refreshProfiles, 5000);
    return () => clearInterval(interval);
  }, [historyDropdownOpen, historyTab, refreshProfiles]);

  const handleViewDungeonDetails = () => {
    if (!detectedDungeonInfo || !simcFooter) return;
    setViewingDungeonRoute({
      id: 'temporary',
      name: detectedDungeonInfo.title,
      dungeon: detectedDungeonInfo.dungeon || 'Unknown',
      level: detectedDungeonInfo.level ? Number(detectedDungeonInfo.level) : undefined,
      pull_count: detectedDungeonInfo.pullCount ?? undefined,
      route_data: simcFooter,
      created_at: new Date().toISOString(),
    });
  };

  const handleSaveRoute = async () => {
    if (!detectedDungeonInfo || !simcFooter) return;
    setIsSavingRoute(true);
    try {
      await saveRoute({
        name: detectedDungeonInfo.title,
        dungeon: detectedDungeonInfo.dungeon || 'Unknown',
        level: detectedDungeonInfo.level ? Number(detectedDungeonInfo.level) : undefined,
        pull_count: detectedDungeonInfo.pullCount || undefined,
        route_data: simcFooter,
      });
      await refreshRoutes();
      setBanner({ text: `Saved route: ${detectedDungeonInfo.title}`, id: Date.now() });
    } catch (e) {
      console.error('Failed to save route:', e);
    } finally {
      setIsSavingRoute(false);
    }
  };

  const handleSelectRoute = (route: SavedRoute) => {
    setSimcFooter(route.route_data);
    setBanner({ text: `Loaded route: ${route.name}`, id: Date.now() });
  };

  const handleDeleteRoute = async (id: string) => {
    try {
      await deleteSavedRoute(id);
      await refreshRoutes();
    } catch (e) {
      console.error('Failed to delete route:', e);
    }
  };

  const handleDeleteProfile = useCallback(async () => {
    if (!deleteProfileId) return;
    try {
      await deleteCharacterProfile(deleteProfileId);
      setBnetProfiles((prev) => prev.filter((p) => p.id !== deleteProfileId));
      if (selectedSavedId === deleteProfileId) {
        setSelectedSavedId(null);
      }
    } catch (err) {
      console.error('Failed to delete profile:', err);
    }
  }, [deleteProfileId, selectedSavedId]);

  const bannerTimerRef = useRef<number | null>(null);
  const lastAppliedClipboardRef = useRef<string>('');
  const simcInputRef = useRef<string>(simcInput);

  useEffect(() => {
    simcInputRef.current = simcInput;
  }, [simcInput]);

  const normalizedPath =
    pathname.endsWith('/') && pathname !== '/' ? pathname.slice(0, -1) : pathname;

  const showConfig =
    normalizedPath === '/quick-sim' ||
    normalizedPath === '/top-gear' ||
    normalizedPath === '/drop-finder' ||
    normalizedPath === '/stat-weights' ||
    normalizedPath.startsWith('/upgrade');

  const selectedProfileMeta = useMemo(() => {
    if (selectedSavedId !== null) {
      const saved = bnetProfiles.find((p) => p.id === selectedSavedId);
      if (!saved) return null;
      const classLabel = [saved.spec ? specDisplayName(saved.spec) : null, saved.class]
        .filter(Boolean)
        .join(' ');
      const realmLabel = [formatRealmName(saved.realm), saved.region ? `(${saved.region})` : null]
        .filter(Boolean)
        .join(' ');
      return {
        name: saved.name,
        classLabel: classLabel || saved.class || null,
        classColor: resolveClassColor(saved.class),
        combinedLabel:
          saved.name && (classLabel || saved.class)
            ? `${saved.name} - ${classLabel || saved.class}`
            : saved.name || classLabel || saved.class || 'Select profile',
        realmLabel: realmLabel || null,
      };
    }

    if (selectedHistoryIdx !== null) {
      const profile = simcInputHistory[selectedHistoryIdx];
      if (!profile) return null;
      const info = parseCharacterInfo(profile);
      if (info?.kind === 'character') {
        const classLabel = [specDisplayName(info.spec), info.className].filter(Boolean).join(' ');
        const realmLabel = [info.server, info.region ? `(${info.region})` : null]
          .filter(Boolean)
          .join(' ');
        return {
          name: info.name,
          classLabel,
          classColor: resolveClassColor(info.className),
          combinedLabel:
            info.name && classLabel
              ? `${info.name} - ${classLabel}`
              : info.name || classLabel || `Profile ${selectedHistoryIdx + 1}`,
          realmLabel: realmLabel || null,
        };
      }
      return {
        name: `Profile ${selectedHistoryIdx + 1}`,
        classLabel: null,
        classColor: undefined,
        combinedLabel: `Profile ${selectedHistoryIdx + 1}`,
        realmLabel: null,
      };
    }

    return null;
  }, [bnetProfiles, selectedHistoryIdx, selectedSavedId, simcInputHistory]);

  const readClipboardText = useCallback(async (): Promise<string> => {
    try {
      // Native desktop invoke can be slower on some systems; avoid aggressive timeout here.
      const raw = await invoke<unknown>('get_clipboard_text');
      const normalized = normalizeClipboardTextPayload(raw);
      if (normalized) return normalized;
    } catch {}

    if (navigator.clipboard?.readText) {
      try {
        return await withTimeout(navigator.clipboard.readText(), 2500);
      } catch {}
    }
    return '';
  }, []);

  useEffect(() => {
    // On mount, capture current clipboard so we only auto-paste *new* changes.
    void readClipboardText().then((text) => {
      if (text) lastAppliedClipboardRef.current = text.trim();
    });
  }, [readClipboardText]);

  useEffect(() => {
    if (typeof window === 'undefined' || !autoClipboardPasteSimc) return;
    let cancelled = false;

    const readClipboardIntoSimc = async (isFocusTrigger = false) => {
      try {
        if (document.visibilityState === 'hidden') return;
        const text = await readClipboardText();
        if (cancelled || !text) return;

        // Always track the last seen clipboard text to avoid re-processing non-SimC text repeatedly.
        // We trim to handle trailing whitespace differences that can happen on some systems.
        const trimmedText = text.trim();
        if (trimmedText === lastAppliedClipboardRef.current) {
          return;
        }
        lastAppliedClipboardRef.current = trimmedText;

        const profiles = splitSimcProfiles(text);
        if (profiles.length === 0) {
          if (isFocusTrigger)
            console.log('[SimSharedConfig] Clipboard content is not a SimC profile.');
          return;
        }

        const first = profiles[0];
        // If it's already what we have in the editor, skip to avoid overwrite.
        if (first.trim() === simcInputRef.current.trim()) {
          if (isFocusTrigger)
            console.log('[SimSharedConfig] Clipboard matches current input, skipping.');
          return;
        }

        if (isMdtString(first)) {
          const mdtInfo = parseMdtString(first) as SimcClipboardInfo | null;
          if (mdtInfo && mdtInfo.kind === 'dungeon') {
            console.log(
              '[SimSharedConfig] Auto-pasting MDT route:',
              (mdtInfo as { title: string }).title,
            );
            const simcData = convertMdtToSimc(mdtInfo);
            setSimcFooter(simcData);
            setBanner({
              text: `Detected and converted MDT route: ${(mdtInfo as { title: string }).title}`,
              id: Date.now(),
            });
            return;
          }
        }

        const info = parseCharacterInfo(first);
        if (info?.kind === 'dungeon') {
          console.log('[SimSharedConfig] Auto-pasting dungeon route:', info.title);
          setSimcFooter(first);
          setBanner({ text: `Detected dungeon route: ${info.title}`, id: Date.now() });
        } else if (info?.kind === 'character') {
          console.log('[SimSharedConfig] Auto-pasting character:', info.name);
          const newIdx = addToHistoryWithSelection(first);
          setSelectedHistoryIdx(newIdx);
          setSimcInput(first);
          setBanner({ text: 'Detected and pasted SimC export.', id: Date.now() });

          // Try to save character profile if character is in BNet roster
          if (info.name && info.server) {
            try {
              const bnetData = await fetchJson<{
                characters: Array<{ name: string; realm: string; region: string }>;
              }>(`${API_URL}/api/bnet/user/characters`).catch(() => ({ characters: [] }));
              const characters = bnetData.characters || [];
              const bnetChar = characters.find(
                (c: any) =>
                  c.name.toLowerCase() === info.name?.toLowerCase() &&
                  c.realm.toLowerCase() === info.server?.toLowerCase(),
              );
              if (bnetChar) {
                await saveCharacterProfile({
                  name: info.name,
                  realm: info.server,
                  region: info.region || 'us',
                  class: info.className,
                  spec: info.spec,
                  simc_input: first,
                });
                console.log('[SimSharedConfig] Saved character profile for:', info.name);
              }
            } catch (e) {
              console.error('[SimSharedConfig] Failed to save character profile:', e);
            }
          }
        } else {
          console.log(
            '[SimSharedConfig] Detected SimC content but could not parse info, pasting anyway.',
          );
          const newIdx = addToHistoryWithSelection(first);
          setSelectedHistoryIdx(newIdx);
          setSimcInput(first);
          setBanner({ text: 'Detected and pasted SimC export.', id: Date.now() });
        }
      } catch (err) {
        console.error('[SimSharedConfig] Auto-paste failed:', err);
      }
    };

    const onFocus = () => void readClipboardIntoSimc(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void readClipboardIntoSimc(true);
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [
    autoClipboardPasteSimc,
    readClipboardText,
    setSimcFooter,
    setSimcInput,
    addToHistoryWithSelection,
  ]);

  useEffect(() => {
    if (!banner) return;
    if (bannerTimerRef.current != null) {
      window.clearTimeout(bannerTimerRef.current);
    }
    bannerTimerRef.current = window.setTimeout(() => {
      setBanner(null);
      bannerTimerRef.current = null;
    }, 3500);
    return () => {
      if (bannerTimerRef.current != null) {
        window.clearTimeout(bannerTimerRef.current);
        bannerTimerRef.current = null;
      }
    };
  }, [banner]);

  if (!showConfig) return null;

  return (
    <div className="mb-6 space-y-4">
      {banner && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[90]">
          <ClipboardBanner message={banner.text} onDismiss={() => setBanner(null)} />
        </div>
      )}
      <div className="card space-y-3 p-5">
        <div className="flex items-center justify-between">
          <label className="label-text">SimC Addon Export</label>
          <div ref={historyDropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setHistoryDropdownOpen(!historyDropdownOpen)}
              className="flex min-w-[220px] items-center justify-between gap-3 rounded-md border border-gold/35 bg-zinc-950/95 px-3 py-1.5 text-left shadow-sm shadow-black/40 transition-colors hover:border-gold/60 hover:bg-zinc-900"
            >
              <div className="min-w-0">
                {selectedProfileMeta?.name && selectedProfileMeta?.classLabel ? (
                  <p className="truncate text-[13px] font-semibold tracking-tight text-zinc-100">
                    <span>{selectedProfileMeta.name}</span>
                    <span className="text-zinc-100"> - </span>
                    <span style={{ color: selectedProfileMeta.classColor || '#f4f4f5' }}>
                      {selectedProfileMeta.classLabel}
                    </span>
                  </p>
                ) : (
                  <p className="truncate text-[13px] font-semibold tracking-tight text-zinc-100">
                    {selectedProfileMeta?.combinedLabel || 'Select profile'}
                  </p>
                )}
                <p className="truncate text-[12px] font-medium text-zinc-100">
                  {selectedProfileMeta?.realmLabel || 'Saved and recent exports'}
                </p>
              </div>
              <svg
                className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${historyDropdownOpen ? 'rotate-180 text-zinc-300' : ''}`}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3.5 6.5L8 11l4.5-4.5" />
              </svg>
            </button>
            {historyDropdownOpen && (
              <div
                className="absolute right-0 top-full z-50 mt-1 min-w-[320px] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950/95 shadow-2xl backdrop-blur">
                <div className="flex border-b border-border">
                  <button
                    type="button"
                    onClick={() => setHistoryTab('saved')}
                    className={`flex-1 border-b-2 px-3 py-2 text-[12px] font-semibold transition-colors ${
                      historyTab === 'saved'
                        ? 'border-gold text-gold'
                        : 'border-transparent text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    Saved ({bnetProfiles.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistoryTab('history')}
                    className={`flex-1 border-b-2 px-3 py-2 text-[12px] font-semibold transition-colors ${
                      historyTab === 'history'
                        ? 'border-gold text-gold'
                        : 'border-transparent text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    History ({simcInputHistory.length})
                  </button>
                </div>
                <div className="max-h-[240px] overflow-y-auto">
                  {historyTab === 'saved' ? (
                    bnetProfiles.length === 0 ? (
                      <div className="px-3 py-4 text-center text-[12px] text-zinc-500">
                        No saved character profiles
                      </div>
                    ) : (
                      bnetProfiles.map((profile) => (
                        <div
                          key={profile.id}
                          className="flex items-center justify-between px-3 py-2.5 hover:bg-white/5"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSavedId(profile.id);
                              setSelectedHistoryIdx(null);
                              setSimcInput(profile.simc_input);
                              addToHistory(profile.simc_input);
                              setHistoryDropdownOpen(false);
                            }}
                            className={`flex-1 text-left ${
                              selectedSavedId === profile.id ? 'text-gold' : ''
                            }`}
                          >
                            <div
                              className="text-[13px] font-semibold text-zinc-100"
                            >
                              {profile.name}
                            </div>
                            <div className="text-[11px] font-medium text-zinc-100">
                              {formatRealmName(profile.realm)} ({profile.region})
                            </div>
                          </button>
                          <span
                            className="text-[11px] font-medium"
                            style={{ color: resolveClassColor(profile.class) || '#71717a' }}
                          >
                            {[profile.spec ? specDisplayName(profile.spec) : null, profile.class]
                              .filter(Boolean)
                              .join(' ')}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteProfileId(profile.id);
                            }}
                            className="ml-2 text-[10px] text-zinc-500 hover:text-red-400"
                          >
                            ✕
                          </button>
                        </div>
                      ))
                    )
                  ) : simcInputHistory.length === 0 ? (
                    <div className="px-3 py-4 text-center text-[12px] text-zinc-500">
                      No history yet
                    </div>
                  ) : (
                    simcInputHistory.map((profile, idx) => {
                      const info = parseCharacterInfo(profile);
                      const name = info?.kind === 'character' ? info.name : `Profile ${idx + 1}`;
                      const charClass = info?.kind === 'character' ? info.className : null;
                      const charSpec = info?.kind === 'character' ? info.spec : null;
                      const realm = info?.kind === 'character' ? info.server : null;
                      const region = info?.kind === 'character' ? info.region : null;
                      return (
                        <div
                          key={idx}
                          className={`flex items-center justify-between px-3 py-2 hover:bg-white/5 ${
                            selectedHistoryIdx === idx ? 'bg-white/5' : ''
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedHistoryIdx(idx);
                              setSimcInput(simcInputHistory[idx]);
                              setHistoryDropdownOpen(false);
                            }}
                            className={`flex-1 text-left ${
                              selectedHistoryIdx === idx ? 'text-gold' : ''
                            }`}
                          >
                            <div
                              className="text-[13px] font-semibold text-zinc-100"
                            >
                              {name}
                            </div>
                            {info?.kind === 'character' && (realm || region) && (
                              <div className="text-[11px] font-medium text-zinc-100">
                                {formatRealmName(realm)}
                                {region ? ` (${region})` : ''}
                              </div>
                            )}
                          </button>
                          {charClass && (
                            <span
                              className="text-[11px] font-medium"
                              style={{ color: resolveClassColor(charClass) || '#71717a' }}
                            >
                              {[charSpec ? specDisplayName(charSpec) : null, charClass]
                                .filter(Boolean)
                                .join(' ')}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const newHistory = simcInputHistory.filter((_, i) => i !== idx);
                              setSimcInputHistory(newHistory);
                              if (selectedHistoryIdx === idx) {
                                setSelectedHistoryIdx(null);
                              } else if (selectedHistoryIdx !== null && selectedHistoryIdx > idx) {
                                setSelectedHistoryIdx(selectedHistoryIdx - 1);
                              }
                            }}
                            className="ml-2 text-[10px] text-zinc-500 hover:text-red-400"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                {historyTab === 'history' && simcInputHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSimcInputHistory([]);
                      setSelectedHistoryIdx(null);
                      setHistoryDropdownOpen(false);
                    }}
                    className="w-full border-t border-border px-3 py-2 text-left text-[12px] text-red-400 hover:bg-red-500/10"
                  >
                    ✕ Clear All
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <SimcInputEditor
          value={simcInput}
          onChange={handleSetSimcInput}
          placeholder="Paste your SimC addon export here..."
        />
        {checksumStatus === 'invalid' && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <svg
              className="h-4 w-4 shrink-0 text-amber-400"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M8 1L1 14h14L8 1zM8 6v4M8 12v.5" />
            </svg>
            <p className="text-[14px] text-amber-300">
              This input appears to have been manually edited. Results may not reflect your actual
              in-game character.
            </p>
          </div>
        )}
        {detectedCharacterInfo && <CharacterInfoBar info={detectedCharacterInfo} />}
        {detectedDungeonInfo && (
          <DungeonInfoBar
            info={detectedDungeonInfo}
            onSave={handleSaveRoute}
            onViewDetails={handleViewDungeonDetails}
            isSaving={isSavingRoute}
            isAlreadySaved={isRouteAlreadySaved}
          />
        )}

        {viewingDungeonRoute && (
          <RouteDetailsModal
            route={viewingDungeonRoute}
            onClose={() => setViewingDungeonRoute(null)}
          />
        )}

        <div className="flex items-center justify-between gap-4 border-t border-white/5 pt-3">
          <div className="flex items-center gap-2">
            <svg
              className="h-4 w-4 text-zinc-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
              />
            </svg>
            <span className="text-[13px] font-bold tracking-tight text-zinc-400">
              Dungeon Route
            </span>
          </div>
          <button
            onClick={() => setIsRouteModalOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-zinc-300 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white"
          >
            <span>{savedRoutes.length} Saved Routes</span>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </div>

        <RouteSelectorModal
          isOpen={isRouteModalOpen}
          onClose={() => setIsRouteModalOpen(false)}
          routes={savedRoutes}
          onSelect={handleSelectRoute}
          onDelete={handleDeleteRoute}
        />
        <ConfirmModal
          isOpen={!!deleteProfileId}
          onClose={() => setDeleteProfileId(null)}
          onConfirm={handleDeleteProfile}
          title="Delete SimC Profile"
          message={`Are you sure you want to delete the saved SimC profile for ${deleteTargetProfile?.name || 'this character'}? This action cannot be undone.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="danger"
        />
      </div>
      <TalentPicker />
      <FightSetupOptions />
      <ConsumablesAndRaidBuffsOptions />
      <AdvancedOptions />
    </div>
  );
}
