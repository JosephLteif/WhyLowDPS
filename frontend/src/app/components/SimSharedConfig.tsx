'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { invoke } from '@tauri-apps/api/core';
import { useSimContext } from './SimContext';
import FightStyleSelector from './FightStyleSelector';
import ScenarioBuilder from './ScenarioBuilder';
import TalentPicker from './TalentPicker';
import { getSimcStatus, isDesktop } from '../lib/api';
import { specDisplayName, CLASS_COLORS } from '../lib/types';
import { getFightStyleParamRules } from '../lib/fight-style';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import { useConsumableOptions } from '../lib/useConsumableOptions';
import { OptionEntry, RAID_BUFF_MATRIX_OPTIONS } from '../lib/sim-options-catalog';

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

const ICON_CACHE = new Map<number, string>();

function useSpellIcons(spellIds: number[]) {
  const [icons, setIcons] = useState<Map<number, string>>(new Map());
  const depKey = spellIds.join(',');

  useEffect(() => {
    const missing = spellIds.filter((id) => id > 0 && !ICON_CACHE.has(id));
    if (missing.length === 0) {
      setIcons(new Map(ICON_CACHE));
      return;
    }

    let cancelled = false;
    Promise.all(
      missing.map(async (id) => {
        try {
          const res = await fetch(
            `https://nether.wowhead.com/tooltip/spell/${id}?dataEnv=1&locale=0`
          );
          if (!res.ok) return;
          const data = await res.json();
          if (data?.icon) ICON_CACHE.set(id, data.icon);
        } catch {
          // Ignore fetch failures and fall back to the catalog slug.
        }
      })
    ).then(() => {
      if (!cancelled) setIcons(new Map(ICON_CACHE));
    });

    return () => {
      cancelled = true;
    };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return icons;
}

type SimcClipboardInfo =
  | {
      kind: 'character';
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
    }
  | {
      kind: 'dungeon';
      title: string;
      dungeon: string | null;
      level: string | null;
      maxTime: string | null;
      pullCount: number | null;
      extras: string[];
    };

function parseCharacterInfo(input: string): SimcClipboardInfo | null {
  if (!input) return null;

  const nameMatch = input.match(/^(\w+)="(.+)"$/m);
  const specMatch = input.match(/^spec=(\w+)/m);
  const characterLevelMatch = input.match(/^level=(.+)$/m);
  const raceMatch = input.match(/^race=(.+)$/m);
  const classKeyMatch = input.match(
    /^(warrior|paladin|hunter|rogue|priest|death_knight|deathknight|shaman|mage|warlock|monk|druid|demon_hunter|demonhunter|evoker)\s*=\s*"?([^"\n,]+)"?/im
  );
  const realmMatch = input.match(/^server=(.+)$/m);
  const regionMatch = input.match(/^region=(.+)$/m);
  const roleMatch = input.match(/^role=(.+)$/m);
  const professionsMatch = input.match(/^professions=(.+)$/m);
  const lootSpecMatch = input.match(/^#\s*loot_spec=(.+)$/m);
  const addonVersionMatch = input.match(/^#\s*SimC Addon\s+(.+)$/m);
  const wowVersionMatch = input.match(/^#\s*WoW\s+(.+)$/m);
  const requiresVersionMatch = input.match(/^#\s*Requires SimulationCraft\s+(.+)$/m);
  const checksumMatch = input.match(/^#\s*Checksum:\s*([0-9a-fA-F]+)/m);
  const talentsCount = (input.match(/^talents=/gim) || []).length;
  const savedLoadouts = (input.match(/^#\s*Saved Loadout:/gim) || []).length;
  const routeMatch = input.match(
    /^(?:dungeon_route|route|mythic_plus_route|mplus_route)\s*=\s*"?([^"\n]+)"?/im
  );
  const fightStyleMatch = input.match(/^fight_style\s*=\s*"?([^"\n]+)"?/im);
  const enemyMatch = input.match(/^enemy\s*=\s*"([^"]+)"/im);
  const dungeonMatch = input.match(
    /^(?:dungeon|instance|mythic_plus_dungeon|keystone_dungeon)\s*=\s*"?([^"\n,]+)"?/im
  );
  const levelMatch = input.match(
    /^(?:keystone_level|level|mythic_plus_level)\s*=\s*"?([^"\n,]+)"?/im
  );
  const maxTimeMatch = input.match(/^max_time\s*=\s*"?([^"\n,]+)"?/im);
  const affixMatch = input.match(/^(?:affix|affixes)\s*=\s*"?([^"\n,]+)"?/im);
  const seasonMatch = input.match(/^(?:season|dungeon_season)\s*=\s*"?([^"\n,]+)"?/im);
  const keyNameMatch = input.match(/^(?:route_name|name)\s*=\s*"?([^"\n,]+)"?/im);
  const titleMatch = input.match(/^#\s*(.+)$/m);
  const dungeonTitleMatch = input.match(/^#\s*(?:dungeon|route|mythic\s*\+)\s*[:\-]\s*(.+)$/im);

  if (nameMatch && classKeyMatch) {
    // Save last character to localStorage for history page
    if (nameMatch[2] && realmMatch?.[1]) {
      try {
        localStorage.setItem(
          'whylowdps_last_character',
          JSON.stringify({ name: nameMatch[2], realm: realmMatch[1], region: regionMatch?.[1] })
        );
      } catch {}
    }

    return {
      kind: 'character',
      className: classKeyMatch[1],
      name: nameMatch[2],
      spec: specMatch?.[1] || 'unknown',
      level: characterLevelMatch?.[1] || null,
      race: raceMatch?.[1] || null,
      region: regionMatch?.[1] || null,
      server: realmMatch?.[1] || null,
      role: roleMatch?.[1] || null,
      professions: professionsMatch?.[1] || null,
      lootSpec: lootSpecMatch?.[1] || null,
      addonVersion: addonVersionMatch?.[1] || null,
      wowVersion: wowVersionMatch?.[1] || null,
      requiresVersion: requiresVersionMatch?.[1] || null,
      talentsCount,
      savedLoadouts,
      checksum: checksumMatch?.[1] || null,
    };
  }

  if (routeMatch || dungeonMatch || input.toLowerCase().includes('dungeon')) {
    const enemyName = enemyMatch?.[1]?.trim() || null;
    const dungeonFromEnemy = enemyName?.match(/^(.+?)\s*-\s*(.+?)\s*\([^)]*\)\s*$/)?.[2] || null;
    const dungeon =
      dungeonMatch?.[1] ||
      dungeonFromEnemy ||
      dungeonTitleMatch?.[1] ||
      titleMatch?.[1] ||
      enemyName;
    const pullCount = (input.match(/^raid_events\+=\/pull,/gim) || []).length || null;
    const extras = [
      fightStyleMatch?.[1] ? `fight_style=${fightStyleMatch[1]}` : null,
      levelMatch?.[1] ? `+${levelMatch[1]}` : null,
      maxTimeMatch?.[1] ? `max_time=${maxTimeMatch[1]}` : null,
      pullCount ? `${pullCount} pulls` : null,
      affixMatch?.[1] || null,
      seasonMatch?.[1] || null,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim());
    return {
      kind: 'dungeon',
      title: dungeon || 'Dungeon route',
      dungeon,
      level: levelMatch?.[1] || null,
      maxTime: maxTimeMatch?.[1] || null,
      pullCount,
      extras,
    };
  }

  return null;
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

  return profiles
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && looksLikeSimcInput(p));
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
      : /^(?:\d+(?:\.\d+)?)$/.test(rawValue)
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
  const typographyClasses =
    'font-mono text-[13px] leading-[1.6] whitespace-pre px-4 py-3';

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
          className={`pointer-events-none absolute inset-0 ${editorHeight} w-full overflow-hidden scrollbar-none ${typographyClasses}`}
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
          className={`relative block ${editorHeight} w-full resize-none overflow-auto bg-transparent text-transparent caret-zinc-100 placeholder-zinc-500 focus:outline-none ${typographyClasses}`}
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-white/5 bg-black/20 px-4 py-2 text-[11px] font-medium">
        {info.role && (
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-600 uppercase tracking-widest text-[9px] font-black">Role</span>
            <span className="text-zinc-300">{info.role}</span>
          </div>
        )}
        {info.race && (
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-600 uppercase tracking-widest text-[9px] font-black">Race</span>
            <span className="text-zinc-300">{info.race}</span>
          </div>
        )}
        {info.lootSpec && (
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-600 uppercase tracking-widest text-[9px] font-black">Loot</span>
            <span className="text-zinc-300">{info.lootSpec}</span>
          </div>
        )}
      </div>

      {expanded && (
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 border-t border-white/5 bg-black/40 p-4">
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">Addon Info</p>
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
              <p className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">Sim Info</p>
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
                <p className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">Professions</p>
                <p className="text-[11px] leading-relaxed text-zinc-300">{info.professions}</p>
              </div>
            )}
            {info.checksum && (
              <div>
                <p className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">Verification</p>
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
}: {
  info: {
    title: string;
    dungeon: string | null;
    level: string | null;
    maxTime: string | null;
    pullCount: number | null;
    extras: string[];
  };
}) {
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
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-bold tracking-tight text-white">
              {info.dungeon || 'Unknown Dungeon'}
            </span>
            {info.level && (
              <span className="shrink-0 rounded bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] font-black text-sky-400">
                +{info.level}
              </span>
            )}
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
            <span key={extra} className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
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
  return (opt.label || '').replace(/\s*\(Quality\s*[1-3]\)\s*$/i, '').replace(/\s+[1-3]\s*$/i, '');
}

function QualityBadge({ quality }: { quality?: number }) {
  if (!quality || quality < 1 || quality > 3) return null;
  const style =
    quality === 3
      ? 'border-amber-300/60 bg-amber-500 shadow-[0_0_8px_rgba(251,191,36,0.3)]'
      : quality === 2
        ? 'border-zinc-300/60 bg-zinc-400 shadow-[0_0_8px_rgba(161,161,170,0.3)]'
        : 'border-orange-400/60 bg-orange-600 shadow-[0_0_8px_rgba(234,88,12,0.3)]';
  return (
    <span
      className={`h-3 w-3 shrink-0 rounded-[2px] border ${style}`}
      title={`Quality ${quality}`}
      aria-label={`Quality ${quality}`}
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
        map.set(family, {
          label: optionSelectLabel(opt),
          icon: opt.icon || '',
          itemId: opt.itemId,
          items: [],
          familyMax: qualityMaxByFamily.get(family) || 0,
        });
      }
      map.get(family)!.items.push(opt);
    }
    return Array.from(map.values());
  }, [options, qualityMaxByFamily]);

  return (
    <div className="space-y-1.5 text-[13px] text-zinc-300">
      <span className="block">{label}</span>
      <div ref={rootRef} className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className={`flex w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-left text-sm ${
            disabled ? 'cursor-not-allowed text-zinc-500 opacity-70' : 'text-zinc-200'
          }`}
        >
          {selected?.icon ? (
            <img
              src={`https://wow.zamimg.com/images/wow/icons/small/${selected.icon}.jpg`}
              alt=""
              className="h-4 w-4 shrink-0 rounded-[3px]"
            />
          ) : (
            <span className="h-4 w-4 shrink-0 rounded-[3px] border border-border bg-surface-2" />
          )}
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{selected ? optionSelectLabel(selected) : 'None'}</span>
            <QualityBadge quality={selectedQuality} />
          </div>
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
        </button>
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
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <img
                      src={`https://wow.zamimg.com/images/wow/icons/small/${group.icon}.jpg`}
                      alt=""
                      className="h-4 w-4 shrink-0 rounded-[3px]"
                    />
                    <span className="truncate">{group.label}</span>
                  </div>
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

                          return (
                            <button
                              key={opt.key}
                              type="button"
                              title={`Quality ${q}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                onChange(opt.token || '');
                                setOpen(false);
                              }}
                              className={`h-3.5 w-3.5 rounded-[2px] border transition-all ${qStyle}`}
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

const SIMC_CHANNEL_LABELS: Record<string, string> = {
  nightly: 'Nightly',
};

function SimcChannelSelector({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const activeLabel = SIMC_CHANNEL_LABELS[value] || value;

  return (
    <div className="space-y-1.5">
      <div className="relative" onBlur={() => setOpen(false)}>
        <button
          type="button"
          onClick={() => !disabled && setOpen(!open)}
          className={`input-field flex h-10 w-full items-center justify-between text-sm ${
            disabled ? 'cursor-not-allowed opacity-70' : ''
          }`}
        >
          <span>{activeLabel}</span>
          <svg
            className={`h-4 w-4 text-zinc-500 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
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
        {open && !disabled && (
          <div className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-surface-2 py-1 shadow-lg shadow-black/40">
            {options.map((channel) => (
              <button
                key={channel}
                type="button"
                onMouseDown={() => {
                  onChange(channel);
                  setOpen(false);
                }}
                className={`flex w-full items-center px-3.5 py-2 text-left text-sm transition-colors ${
                  channel === value
                    ? 'bg-gold/[0.08] text-gold'
                    : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                }`}
              >
                {SIMC_CHANNEL_LABELS[channel] || channel}
              </button>
            ))}
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
    fightStyle,
    setFightStyle,
    targetCount,
    setTargetCount,
    fightLength,
    setFightLength,
    customApl,
    setCustomApl,
    simcChannel,
    setSimcChannel,
    includeTimeline,
    setIncludeTimeline,
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
  const [simcChannelLoading, setSimcChannelLoading] = useState(false);

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
  const fightStyleRules = getFightStyleParamRules(fightStyle);
  const refreshInstalledSimcChannels = useCallback(async () => {
    if (!isDesktop) {
      setInstalledSimcChannels(['nightly']);
      return;
    }
    setSimcChannelLoading(true);
    try {
      const nightly = await getSimcStatus();
      const installed = [nightly.installed_exists ? 'nightly' : null].filter(Boolean) as string[];
      setInstalledSimcChannels(installed.length > 0 ? installed : ['nightly']);
    } catch {
      setInstalledSimcChannels(['nightly']);
    } finally {
      setSimcChannelLoading(false);
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
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                Object.values(raidBuffBindings).forEach((b) => b.setChecked(true));
              }}
              className="text-[12px] font-bold text-gold/80 transition-colors hover:text-gold"
            >
              Select All
            </button>
            <span className="h-3 w-px bg-zinc-700" />
            <button
              type="button"
              onClick={() => {
                Object.values(raidBuffBindings).forEach((b) => b.setChecked(false));
              }}
              className="text-[12px] font-bold text-zinc-500 transition-colors hover:text-zinc-300"
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

export default function SimSharedConfig() {
  const pathname = usePathname();
  const {
    simcInput,
    setSimcInput,
    simcFooter,
    setSimcFooter,
    autoClipboardPasteSimc,
  } = useSimContext();
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
    normalizedPath === '/upgrade-compare';

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
    void readClipboardText().then(text => {
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
          if (isFocusTrigger) console.log('[SimSharedConfig] Clipboard content is not a SimC profile.');
          return;
        }

        const first = profiles[0];
        // If it's already what we have in the editor, skip to avoid overwrite.
        if (first.trim() === simcInputRef.current.trim()) {
          if (isFocusTrigger) console.log('[SimSharedConfig] Clipboard matches current input, skipping.');
          return;
        }

        const info = parseCharacterInfo(first);
        if (info?.kind === 'dungeon') {
          console.log('[SimSharedConfig] Auto-pasting dungeon route:', info.title);
          setSimcFooter(first);
          setBanner({ text: `Detected dungeon route: ${info.title}`, id: Date.now() });
        } else if (info?.kind === 'character') {
          console.log('[SimSharedConfig] Auto-pasting character:', info.name);
          setSimcInput(first);
          setBanner({ text: 'Detected and pasted SimC export.', id: Date.now() });
        } else {
          console.log('[SimSharedConfig] Detected SimC content but could not parse info, pasting anyway.');
          setSimcInput(first);
          setBanner({ text: 'Detected and pasted SimC export.', id: Date.now() });
        }
      } catch (err) {
        console.error('[SimSharedConfig] Auto-paste failed:', err);
      }
    };

    const onFocus = () => void readClipboardIntoSimc(true);
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') void readClipboardIntoSimc(true); };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    const poll = setInterval(() => void readClipboardIntoSimc(false), 2000);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearInterval(poll);
    };
  }, [autoClipboardPasteSimc, readClipboardText, setSimcFooter, setSimcInput]);

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
        </div>
        <SimcInputEditor
          value={simcInput}
          onChange={setSimcInput}
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
        {detectedDungeonInfo && <DungeonInfoBar info={detectedDungeonInfo} />}
      </div>
      <TalentPicker />
      <FightSetupOptions />
      <ConsumablesAndRaidBuffsOptions />
      <AdvancedOptions />
    </div>
  );
}
