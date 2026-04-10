'use client';

import { useMemo } from 'react';
import {
  useItemInfo,
  useEnchantInfo,
  useGemInfo,
  getIconUrl,
  getWowheadUrl,
  getWowheadData,
  QUALITY_COLORS,
} from '../lib/useItemInfo';
import type { ItemInfo, EnchantInfo, GemInfo, ItemQuery } from '../lib/useItemInfo';
import { SLOT_LABELS } from '../lib/types';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import type { BlizzardItem } from '../lib/simc-generator';
import TalentTree from './TalentTree';
import { useTalentTree } from '../lib/useTalentTree';
import { encodeTalentString, normalizeTalentString } from '../lib/talentEncode';
import { decodeHeader } from '../lib/talentDecode';
import type { NodeSelection } from '../lib/talentDecode';
import { generateSimcString } from '../lib/simc-generator';
import { useState } from 'react';

const GEAR_ORDER_LEFT = ['HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'WRIST'];
const GEAR_ORDER_RIGHT = [
  'HANDS',
  'WAIST',
  'LEGS',
  'FEET',
  'FINGER_1',
  'FINGER_2',
  'TRINKET_1',
  'TRINKET_2',
];
const GEAR_ORDER_BOTTOM = ['MAIN_HAND', 'OFF_HAND'];
const TALENT_EXPORT_RE = /^[A-Za-z0-9+/]+$/;

function isTalentExportString(value: string, expectedSpecId?: number | null): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 16 || !TALENT_EXPORT_RE.test(trimmed)) return false;
  try {
    const header = decodeHeader(trimmed);
    if (header.bits.length <= header.offset) return false;
    if (header.specId <= 0) return false;
    if (expectedSpecId && header.specId !== expectedSpecId) return false;
    return true;
  } catch {
    return false;
  }
}

function findTalentExportString(input: unknown, expectedSpecId?: number | null): string | null {
  if (!input || typeof input !== 'object') return null;
  const seen = new Set<unknown>();
  const stack: unknown[] = [input];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    if (typeof current === 'string') {
      if (isTalentExportString(current, expectedSpecId)) return current.trim();
      continue;
    }

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    if (typeof current === 'object') {
      for (const value of Object.values(current as Record<string, unknown>)) {
        if (typeof value === 'string') {
          if (isTalentExportString(value, expectedSpecId)) return value.trim();
        } else if (value && typeof value === 'object') {
          stack.push(value);
        }
      }
    }
  }

  return null;
}

interface CharacterPanelProps {
  name: string;
  realm: string;
  region: string;
  characterClass: string;
  race: string;
  level: number;
  equipment: { equipped_items: BlizzardItem[] };
  statistics: any;
  specializations: any;
  professions: any;
  characterMediaUrl?: string | null;
}

export default function CharacterPanel({
  name,
  realm,
  region,
  characterClass,
  race,
  level,
  equipment,
  statistics,
  specializations,
  professions,
  characterMediaUrl,
}: CharacterPanelProps) {
  const realmSlug = realm.toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');
  const armoryUrl = `https://worldofwarcraft.blizzard.com/en-us/character/${region.toLowerCase()}/${realmSlug}/${name.toLowerCase()}`;

  const [copied, setCopied] = useState(false);
  const itemsBySlot = useMemo(() => {
    const map: Record<string, BlizzardItem> = {};
    for (const item of equipment.equipped_items || []) {
      map[item.slot.type] = item;
    }
    return map;
  }, [equipment]);

  // --- Talent & Spec Logic (Lifted for SimC Generation) ---
  const activeSpec = useMemo(() => {
    if (!specializations?.specializations) return null;
    const activeId = specializations.active_specialization?.id;
    if (activeId) {
      return specializations.specializations.find((s: any) => s.specialization.id === activeId);
    }
    return specializations.specializations.find((s: any) =>
      s.loadouts?.some((l: any) => l.is_active)
    );
  }, [specializations]);

  const activeLoadout = useMemo(() => {
    if (!activeSpec?.loadouts) return null;
    return activeSpec.loadouts.find((l: any) => l.is_active);
  }, [activeSpec]);

  const specId = activeSpec?.specialization?.id ?? null;
  const specName = activeSpec?.specialization?.name ?? null;
  const tree = useTalentTree(specId);

  const talentString = useMemo(() => {
    if (!tree || !specId) return null;
    try {
      const directCandidates = [
        activeLoadout?.talent_loadout_code,
        activeLoadout?.talentLoadoutCode,
        activeLoadout?.loadout_code,
        activeLoadout?.code,
        activeSpec?.talent_loadout_code,
        activeSpec?.talentLoadoutCode,
      ].filter((v): v is string => typeof v === 'string');
      const direct = directCandidates.find((v) => isTalentExportString(v, specId));
      if (direct) return normalizeTalentString(direct, tree);

      const discovered =
        findTalentExportString(activeLoadout, specId) ?? findTalentExportString(activeSpec, specId);
      if (discovered) return normalizeTalentString(discovered, tree);

      const selections = new Map<number, NodeSelection>();
      const selectedTalents = [
        ...(activeLoadout?.selected_class_talents || []),
        ...(activeLoadout?.selected_spec_talents || []),
        ...(activeLoadout?.selected_hero_talents || []),
      ];
      const talents = [...selectedTalents, ...(activeSpec.talents || [])];
      const allNodes = [...tree.classNodes, ...tree.specNodes, ...tree.heroNodes];

      for (const t of talents) {
        const candidateIds = [
          t.id,
          t.talent?.id,
          t.tooltip_spell?.id,
          t.spell_tooltip?.spell?.id,
          t.selected_tooltip?.spell?.id,
        ].filter((id): id is number => typeof id === 'number' && Number.isFinite(id));
        if (candidateIds.length === 0) continue;

        const node = allNodes.find((n) =>
          candidateIds.some(
            (id) => n.id === id || n.entries.some((e) => e.id === id || e.spellId === id)
          )
        );
        if (node) {
          const choiceIndex = node.entries.findIndex((e) =>
            candidateIds.some((id) => e.id === id || e.spellId === id)
          );
          const existing = selections.get(node.id);
          const nextRanks = Math.max(existing?.ranks ?? 0, t.rank ?? node.maxRanks ?? 1);
          const nextChoice =
            choiceIndex >= 0 ? choiceIndex : (existing?.choiceIndex ?? -1);
          selections.set(node.id, {
            ranks: nextRanks,
            choiceIndex: nextChoice,
          });
        }
      }
      if (selections.size === 0) return null;
      return normalizeTalentString(encodeTalentString(selections, tree, specId), tree);
    } catch (err) {
      console.warn('Failed to encode talent string:', err);
      return null;
    }
  }, [activeLoadout, tree, specId, activeSpec]);

  const handleCopySimc = () => {
    const simcString = generateSimcString(
      { name, realm, region, race, level, ...statistics, class: characterClass, professions },
      equipment,
      talentString,
      specName
    );
    navigator.clipboard.writeText(simcString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  // --- End Talent & SimC Logic ---

  const allItemQueries = useMemo(() => {
    return (equipment.equipped_items || []).map((it) => ({
      item_id: it.item.id,
      bonus_ids: it.bonus_list,
    }));
  }, [equipment]);

  const itemInfoMap = useItemInfo(allItemQueries);

  const allEnchantIds = useMemo(() => {
    const ids = new Set<number>();
    for (const it of equipment.equipped_items || []) {
      for (const e of it.enchantments || []) {
        if (e.enchantment_id) ids.add(e.enchantment_id);
      }
    }
    return [...ids];
  }, [equipment]);

  const enchantInfoMap = useEnchantInfo(allEnchantIds);

  const allGemIds = useMemo(() => {
    const ids = new Set<number>();
    for (const it of equipment.equipped_items || []) {
      for (const s of it.sockets || []) {
        if (s.item?.id) ids.add(s.item.id);
      }
    }
    return [...ids];
  }, [equipment]);

  const gemInfoMap = useGemInfo(allGemIds);
  useWowheadTooltips([equipment, itemInfoMap]);

  return (
    <div className="flex flex-col gap-6">
      {/* Quick Links Bar (Top Left) */}
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={armoryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-bold text-zinc-300 ring-1 ring-white/5 transition-all hover:bg-white/10 hover:text-white active:scale-95"
        >
          <img
            src="/icons/blizzard.png"
            alt=""
            className="h-3.5 w-3.5 opacity-70"
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
          Official Armory
        </a>
        <a
          href={`https://www.warcraftlogs.com/character/${region.toLowerCase()}/${realmSlug}/${name.toLowerCase()}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg border border-[#ca3333]/20 bg-[#ca3333]/10 px-3 py-1.5 text-xs font-bold text-[#ff4d4d] ring-1 ring-white/5 transition-all hover:bg-[#ca3333]/20 hover:text-[#ff6666] active:scale-95"
        >
          Warcraft Logs
        </a>
        <a
          href={`https://raider.io/characters/${region.toLowerCase()}/${realmSlug}/${name.toLowerCase()}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg border border-[#fb8c00]/20 bg-[#fb8c00]/10 px-3 py-1.5 text-xs font-bold text-[#ffb74d] ring-1 ring-white/5 transition-all hover:bg-[#fb8c00]/20 hover:text-[#ffcc80] active:scale-95"
        >
          Raider.io
        </a>

        <div className="mx-2 h-4 w-px bg-white/10" />

        <button
          disabled
          className="flex cursor-not-allowed items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5 text-xs font-bold text-zinc-500 opacity-50"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3z" />
          </svg>
          Copy SimC String (Parked)
        </button>
      </div>

      {/* Upper Section: Gear & Stats */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        {/* Gear Panel */}
        <div className="card relative min-h-[600px] overflow-hidden p-6">
          {characterMediaUrl && (
            <div className="group absolute inset-0 z-10 flex cursor-pointer items-center justify-center">
              <img
                src={characterMediaUrl}
                alt={name}
                className="pointer-events-none mx-auto h-[120%] w-auto -translate-y-[10%] object-contain opacity-40 mix-blend-lighten transition-all duration-500 group-hover:scale-105 group-hover:opacity-70 group-hover:brightness-110"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          )}

          <div className="relative grid grid-cols-[auto_1fr_auto] gap-x-8">
            {/* Left Column */}
            <div className="space-y-3">
              {GEAR_ORDER_LEFT.map((slot) => (
                <BlizzardGearSlot
                  key={slot}
                  slot={slot}
                  item={itemsBySlot[slot]}
                  itemInfoMap={itemInfoMap}
                  enchantInfoMap={enchantInfoMap}
                  gemInfoMap={gemInfoMap}
                />
              ))}
            </div>

            <div />

            {/* Right Column */}
            <div className="space-y-3">
              {GEAR_ORDER_RIGHT.map((slot) => (
                <BlizzardGearSlot
                  key={slot}
                  slot={slot}
                  item={itemsBySlot[slot]}
                  itemInfoMap={itemInfoMap}
                  enchantInfoMap={enchantInfoMap}
                  gemInfoMap={gemInfoMap}
                  align="right"
                />
              ))}
            </div>
          </div>

          {/* Bottom Column */}
          <div className="relative mt-8 flex justify-center gap-8">
            {GEAR_ORDER_BOTTOM.map((slot) => (
              <BlizzardGearSlot
                key={slot}
                slot={slot}
                item={itemsBySlot[slot]}
                itemInfoMap={itemInfoMap}
                enchantInfoMap={enchantInfoMap}
                gemInfoMap={gemInfoMap}
              />
            ))}
          </div>
        </div>

        {/* Stats Column */}
        <div className="flex flex-col gap-4">
          <StatsCard statistics={statistics} />
        </div>
      </div>

      {/* Lower Section: Talents (Full Width) */}
      <div className="w-full">
        <TalentsCard
          activeSpec={activeSpec}
          activeLoadout={activeLoadout}
          talentString={talentString}
          specId={specId}
          tree={tree}
        />
      </div>
    </div>
  );
}

function BlizzardGearSlot({
  slot,
  item,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
  align = 'left',
}: {
  slot: string;
  item?: BlizzardItem;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
  align?: 'left' | 'right';
}) {
  const rtl = align === 'right';
  const label = SLOT_LABELS[slot.toLowerCase()] || slot;

  if (!item) {
    return (
      <div className={`flex items-center gap-3 ${rtl ? 'flex-row-reverse' : ''}`}>
        <div className="h-12 w-12 shrink-0 rounded-lg border border-white/5 bg-white/[0.02]" />
        <div className={rtl ? 'text-right' : ''}>
          <p className="text-[13px] font-medium text-zinc-500">{label}</p>
        </div>
      </div>
    );
  }

  const info = itemInfoMap[item.item.id];
  const qc = info ? QUALITY_COLORS[info.quality] || '#fff' : '#fff';
  const icon = info?.icon || 'inv_misc_questionmark';

  // Extract first enchant and gem for display
  const enchantId = item.enchantments?.[0]?.enchantment_id;
  const gemId = item.sockets?.[0]?.item?.id;

  const enchant = enchantId ? enchantInfoMap[enchantId] : undefined;
  const gem = gemId ? gemInfoMap[gemId] : undefined;

  const whData = getWowheadData(item.bonus_list, item.level?.value, enchantId, gemId);

  return (
    <div className={`flex items-start gap-3 ${rtl ? 'flex-row-reverse' : ''}`}>
      <div
        className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border transition-transform hover:scale-105"
        style={{ borderColor: `${qc}44` }}
      >
        <img src={getIconUrl(icon)} alt="" className="h-full w-full object-cover" />
        <div
          className="absolute inset-0 ring-1 ring-inset ring-white/10"
          style={{ boxShadow: `inset 0 0 10px ${qc}33` }}
        />
      </div>
      <div className={`min-w-0 flex-1 ${rtl ? 'text-right' : ''}`}>
        <a
          href={getWowheadUrl(item.item.id)}
          data-wowhead={whData}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-[14px] font-bold leading-tight hover:underline"
          style={{ color: qc }}
        >
          {item.name}
        </a>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] font-medium text-zinc-500">
          <span className="text-zinc-400">
            {item.level?.value} {label}
          </span>
          {enchant && <span className="text-emerald-400/80">· {enchant.name}</span>}
          {gem && <span className="text-sky-400/80">· {gem.name}</span>}
        </div>
      </div>
    </div>
  );
}

function StatsCard({ statistics }: { statistics: any }) {
  const stats = useMemo(() => {
    if (!statistics) return [];

    const getEffectiveValue = (stat?: any) => {
      if (typeof stat === 'number') return stat.toLocaleString();
      if (stat?.effective !== undefined) return Math.round(stat.effective).toLocaleString();
      if (stat?.value !== undefined) return Math.round(stat.value).toLocaleString();
      return '0';
    };

    const getPercentValue = (stat?: any, rating?: any) => {
      const p =
        stat?.value ??
        stat?.percent ??
        stat?.rating_bonus ??
        (typeof stat === 'number' ? stat : null);
      if (p === null) return null;

      const r =
        rating?.rating_normalized ?? rating?.rating ?? (typeof rating === 'number' ? rating : null);
      const percStr = p.toFixed(2) + '%';
      return r !== null ? `${Math.round(r)} (${percStr})` : percStr;
    };

    // Find the relevant primary stat (Int/Agi/Str)
    const mainStat = statistics.intellect || statistics.agility || statistics.strength;

    // Find the relevant crit/haste/mastery (they are usually mirrored in modern WoW, but we pick the best one)
    const crit =
      statistics.melee_crit || statistics.spell_crit || statistics.ranged_crit || statistics.crit;
    const haste =
      statistics.melee_haste ||
      statistics.spell_haste ||
      statistics.ranged_haste ||
      statistics.haste;
    const mastery = statistics.mastery;
    const versatility = statistics.versatility_offensive_modifier ?? statistics.versatility;

    const list = [
      { label: 'Main Stat', value: getEffectiveValue(mainStat) },
      { label: 'Stamina', value: getEffectiveValue(statistics.stamina) },
      null,
      { label: 'Crit', value: getPercentValue(crit, crit) ?? '0.0%' },
      { label: 'Haste', value: getPercentValue(haste, haste) ?? '0.0%' },
      { label: 'Mastery', value: getPercentValue(mastery, mastery) ?? '0.0%' },
      {
        label: 'Versatility',
        value: getPercentValue(versatility, statistics.versatility) ?? '0.0%',
      },
    ];

    return list;
  }, [statistics]);

  if (!statistics) {
    return (
      <div className="card p-5 opacity-40">
        <h1 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
          Attributes
        </h1>
        <p className="text-[11px] italic text-zinc-600">Loading attributes...</p>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-zinc-500">Attributes</h3>
      <div className="space-y-2">
        {stats.map((s, i) =>
          s === null ? (
            <div key={`sep-${i}`} className="my-3 h-px bg-white/5" />
          ) : (
            <div key={s.label} className="flex justify-between text-[13px]">
              <span className="text-zinc-400">{s.label}</span>
              <span className="font-mono font-bold text-zinc-200">{s.value}</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function TalentsCard({
  activeSpec,
  activeLoadout,
  talentString,
  specId,
  tree,
}: {
  activeSpec: any;
  activeLoadout: any;
  talentString: string | null;
  specId: number | null;
  tree: any;
}) {
  const loading = specId !== null && !tree;
  const [copiedTalentTree, setCopiedTalentTree] = useState(false);

  if (!activeSpec) {
    return (
      <div className="card p-5 opacity-40">
        <h1 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Talents</h1>
        <p className="text-[11px] italic text-zinc-600">
          Talent data unavailable for this character (Privacy settings or 404).
        </p>
      </div>
    );
  }

  const talentNames = [
    ...(activeLoadout?.selected_class_talents || []),
    ...(activeLoadout?.selected_spec_talents || []),
    ...(activeLoadout?.selected_hero_talents || []),
    ...(activeSpec?.talents || []),
  ]
    .map((t: any) => t.tooltip_spell?.name || t.talent?.name)
    .filter(Boolean);

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-white/5 bg-white/[0.01] p-5">
        <div className="flex items-center justify-between">
          <h1 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
            Specialization: <span className="text-gold">{activeSpec.specialization.name}</span>
          </h1>
          <div className="flex items-center gap-2">
            {talentString && (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(talentString);
                  setCopiedTalentTree(true);
                  setTimeout(() => setCopiedTalentTree(false), 1500);
                }}
                className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] font-bold text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-white"
              >
                {copiedTalentTree ? 'Copied' : 'Copy Talent Tree'}
              </button>
            )}
            {loading && (
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-gold border-t-transparent" />
            )}
          </div>
        </div>
      </div>

      {talentString ? (
        <div className="bg-black/20 p-2">
          <div
            className="origin-top scale-100 transform transition-opacity duration-500"
            style={{ opacity: loading ? 0.3 : 1 }}
          >
            <TalentTree talentString={talentString} specId={specId ?? undefined} bare />
          </div>
        </div>
      ) : (
        <div className="p-5">
          <div className="flex flex-wrap gap-1.5">
            {talentNames.length > 0 ? (
              talentNames.map((name: string, i: number) => (
                <span
                  key={`${name}-${i}`}
                  className="rounded-md bg-white/[0.03] px-2 py-1 text-[10px] font-bold text-zinc-400 ring-1 ring-inset ring-white/5"
                >
                  {name}
                </span>
              ))
            ) : (
              <p className="text-[11px] italic text-zinc-600">No talent data available</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
