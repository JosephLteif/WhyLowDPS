'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleX } from 'lucide-react';
import type { ResolvedItem } from '../../lib/types';
import { API_URL } from '../../lib/api';
import { buildGearItemIdentity } from '../../lib/gear-utils';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';
import {
  deduplicateEnchants as sharedDeduplicateEnchants,
  deduplicateGems as sharedDeduplicateGems,
  enchantFitsSpec as sharedEnchantFitsSpec,
  gemFitsSpec as sharedGemFitsSpec,
  normalizeEnchantOptions as sharedNormalizeEnchantOptions,
  sortGemOptions as sharedSortGemOptions,
  type RawEnchantOption,
  type RawGemOption,
} from './affixOptionUtils';

interface RawEnchant {
  id?: number;
  enchant_id?: number;
  name?: string;
  displayName?: string;
  baseDisplayName?: string;
  itemId?: number;
  itemName?: string;
  itemIcon?: string;
  spellIcon?: string;
  quality?: number;
  expansion?: number;
  craftingQuality?: number;
  slot?: string;
  effectKey?: string | null;
  effectAmounts?: number[] | null;
}

interface RawGem {
  id?: number;
  item_id?: number;
  name?: string;
  icon?: string;
  displayName?: string;
  itemId?: number;
  itemName?: string;
  itemIcon?: string;
  quality?: number;
  expansion?: number;
  craftingQuality?: number;
  label?: string;
  category?: string;
  primaryStat?: string | null;
  primaryAmount?: number | null;
  secondaryStat?: string | null;
  secondaryAmount?: number | null;
  isPvp?: boolean;
}

interface EnchantDisplay {
  enchantId: number;
  name: string;
  icon: string;
  quality: number;
  itemId: number;
  baseKey: string;
  effectKey: string | null;
  effectAmounts: number[];
  craftingQuality: number;
}

interface GemDisplay {
  gemItemId: number;
  enchantId: number;
  name: string;
  label: string;
  icon: string;
  quality: number;
  expansion: number;
  category: string;
  primaryStat: GemStatKey | null;
  primaryAmount: number | null;
  secondaryStat: GemStatKey | null;
  secondaryAmount: number | null;
  isPvp: boolean;
}

interface GemColumn {
  key: string;
  label: string;
  gems: GemDisplay[];
}

interface SkeletonGroup {
  key: string;
  label: string;
  itemCount: number;
  wide?: boolean;
}

interface SelectableOptionRowProps {
  isSelected: boolean;
  label: string;
  sublabel?: string;
  icon: string;
  leadingIcon?: React.ReactNode;
  quality?: number;
  wowheadHref?: string;
  wowheadData?: string;
  equipped?: boolean;
  onToggle: () => void;
}

type GemStatKey = 'crit' | 'haste' | 'mast' | 'vers';

interface EmbellishmentOption {
  id: number;
  item_id: number;
  name: string;
  icon: string;
  quality: number;
  bonus_ids: number[];
}

interface VariantRequest {
  item: ResolvedItem;
  enchantId: number;
  gemIds: number[];
  embellishment: EmbellishmentOption | null;
  forceClearEnchant?: boolean;
  bundleId?: string;
}

interface TopGearVariantStudioProps {
  isOpen: boolean;
  onClose: () => void;
  items: ResolvedItem[];
  equippedItems?: ResolvedItem[];
  savedVariantsBySlot?: Record<string, ResolvedItem[]>;
  savedRuleState?: SavedVariantStudioState | null;
  globalAffixesEnabled?: boolean;
  className?: string | null;
  specName?: string | null;
  copyEnchants?: boolean;
  onApplyBatch: (requests: VariantRequest[]) => number;
  onStateChange?: (state: SavedVariantStudioState) => void;
}

interface ItemOptionSet {
  enchants: EnchantDisplay[];
}

interface RuleGroup {
  key: string;
  label: string;
  items: ResolvedItem[];
  enchantOptions: EnchantDisplay[];
}

interface GroupSelection {
  enchantIds: number[];
  includeNone: boolean;
  touched: boolean;
}

type GemScope = 'all' | 'rings' | 'neck' | 'gear';

export interface SavedVariantStudioState {
  groupSelections: Record<string, GroupSelection>;
  globalGemIds: number[];
  includeEmptyGemChoice: boolean;
  gemSelectionTouched: boolean;
  overrideExistingEnchants: boolean;
  overrideExistingGems: boolean;
  gemScope: GemScope;
}

const MIN_VISIBLE_OPTION_QUALITY = 3;

const SLOT_SCOPE: Record<string, { key: string; label: string }> = {
  head: { key: 'head', label: 'Head' },
  neck: { key: 'neck', label: 'Neck' },
  shoulder: { key: 'shoulder', label: 'Shoulders' },
  back: { key: 'back', label: 'Back' },
  chest: { key: 'chest', label: 'Chest' },
  wrist: { key: 'wrist', label: 'Wrists' },
  hands: { key: 'hands', label: 'Hands' },
  waist: { key: 'waist', label: 'Waist' },
  legs: { key: 'legs', label: 'Legs' },
  feet: { key: 'feet', label: 'Feet' },
  finger1: { key: 'rings', label: 'Rings' },
  finger2: { key: 'rings', label: 'Rings' },
  trinket1: { key: 'trinkets', label: 'Trinkets' },
  trinket2: { key: 'trinkets', label: 'Trinkets' },
  main_hand: { key: 'main_hand', label: 'Main Hand' },
  off_hand: { key: 'off_hand', label: 'Off Hand' },
};

function parseGemIdsFromItem(item: ResolvedItem | null): number[] {
  if (!item) return [];
  if (item.gem_ids && item.gem_ids.length > 0) {
    return item.gem_ids.filter((id) => Number.isFinite(id) && id > 0);
  }
  if (item.gem_id > 0) {
    return [item.gem_id];
  }
  const match = item.simc_string.match(/(?:^|,)gem_id=([0-9/:]+)/);
  if (!match) return [];
  return match[1]
    .split(/[/:]/)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function parseEnchantIdFromItem(item: ResolvedItem): number {
  if (item.enchant_id > 0) return item.enchant_id;
  const match = item.simc_string.match(/(?:^|,)enchant_id=([0-9]+)/);
  if (!match) return 0;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueNumberValues(values: number[]): number[] {
  return Array.from(new Set(values.filter((value) => Number.isFinite(value) && value > 0)));
}

function toEnchantDisplay(enchant: RawEnchant): EnchantDisplay {
  const name = enchant.itemName || enchant.displayName || enchant.name || 'Unknown';
  return {
    enchantId: enchant.enchant_id ?? enchant.id ?? 0,
    name,
    icon: enchant.itemIcon || enchant.spellIcon || 'inv_misc_questionmark',
    quality: enchant.quality ?? 3,
    itemId: enchant.itemId ?? 0,
    baseKey:
      enchant.baseDisplayName ||
      enchant.itemName ||
      enchant.displayName ||
      enchant.name ||
      `enchant-${enchant.enchant_id ?? enchant.id ?? 0}`,
    effectKey: enchant.effectKey?.trim() || null,
    effectAmounts: Array.isArray(enchant.effectAmounts)
      ? enchant.effectAmounts.filter((value) => Number.isFinite(value))
      : [],
    craftingQuality: enchant.craftingQuality ?? 0,
  };
}

function normalizeEnchantOptions(raw: RawEnchant[]): EnchantDisplay[] {
  return sharedNormalizeEnchantOptions(raw as RawEnchantOption[]) as EnchantDisplay[];
}

function compareEnchantStrength(current: EnchantDisplay, existing: EnchantDisplay): number {
  const maxLength = Math.max(current.effectAmounts.length, existing.effectAmounts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const currentAmount = current.effectAmounts[index] ?? -1;
    const existingAmount = existing.effectAmounts[index] ?? -1;
    if (currentAmount !== existingAmount) {
      return currentAmount - existingAmount;
    }
  }

  if (current.craftingQuality !== existing.craftingQuality) {
    return current.craftingQuality - existing.craftingQuality;
  }

  if (current.quality !== existing.quality) {
    return current.quality - existing.quality;
  }

  return 0;
}

function deduplicateEnchants(
  options: EnchantDisplay[],
  showAll: boolean,
  _pinnedEnchantIds: number[] = []
): EnchantDisplay[] {
  return sharedDeduplicateEnchants(options, showAll) as EnchantDisplay[];
}

function toGemDisplay(gem: RawGem): GemDisplay {
  return {
    gemItemId: gem.item_id ?? gem.itemId ?? gem.id ?? 0,
    enchantId: gem.id ?? 0,
    name: gem.itemName || gem.displayName || gem.name || 'Unknown',
    label: gem.label || gem.itemName || gem.displayName || gem.name || 'Unknown',
    icon: gem.itemIcon || gem.icon || 'inv_misc_questionmark',
    quality: gem.quality ?? 3,
    expansion: gem.expansion ?? 0,
    category: gem.category || 'special',
    primaryStat: (gem.primaryStat as GemStatKey | null | undefined) ?? null,
    primaryAmount: gem.primaryAmount ?? null,
    secondaryStat: (gem.secondaryStat as GemStatKey | null | undefined) ?? null,
    secondaryAmount: gem.secondaryAmount ?? null,
    isPvp: gem.isPvp ?? false,
  };
}

function gemStrength(gem: RawGem): [number, number, number] {
  return [gem.primaryAmount ?? 0, gem.secondaryAmount ?? 0, gem.craftingQuality ?? 0];
}

function compareGemStrength(current: RawGem, existing: RawGem): number {
  const [currentPrimary, currentSecondary, currentQuality] = gemStrength(current);
  const [existingPrimary, existingSecondary, existingQuality] = gemStrength(existing);

  if (currentPrimary !== existingPrimary) {
    return currentPrimary - existingPrimary;
  }
  if (currentSecondary !== existingSecondary) {
    return currentSecondary - existingSecondary;
  }
  return currentQuality - existingQuality;
}

function gemEffectKey(gem: RawGem): string {
  const category = gem.category || 'special';
  const primaryStat = gem.primaryStat || 'none';
  const secondaryStat = gem.secondaryStat || 'none';

  if (category === 'special') {
    return `special:${gem.itemName || gem.displayName || gem.name || gem.item_id || gem.id || 0}`;
  }

  return `${category}:${primaryStat}:${secondaryStat}`;
}

function deduplicateGems(raw: RawGem[], showAll: boolean, pinnedGemIds: number[] = []): GemDisplay[] {
  const kept = sharedDeduplicateGems(raw as RawGemOption[], showAll) as GemDisplay[];
  const pinnedSet = new Set(pinnedGemIds);
  for (const gem of raw) {
    const gemItemId = gem.item_id ?? gem.itemId ?? gem.id ?? 0;
    if (!pinnedSet.has(gemItemId)) continue;
    if (!kept.some((entry) => entry.gemItemId === gemItemId)) {
      kept.push(toGemDisplay(gem));
    }
  }
  return kept.filter((gem) => gem.gemItemId > 0);
}

function sameNumberArray(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function buildSocketGemArray(socketCount: number, gemId: number): number[] {
  if (gemId <= 0 || socketCount <= 0) return [];
  return Array.from({ length: socketCount }, () => gemId);
}

function buildVariantRuleBaseKey(item: ResolvedItem): string {
  return buildGearItemIdentity({
    item_id: item.item_id,
    bonus_ids: item.bonus_ids,
    origin: 'variant-rules',
    ilevel: item.ilevel,
    enchant_id: 0,
    gem_id: 0,
    gem_ids: [],
    crafted_stats: item.crafted_stats,
    embellishment_item_id: item.embellishment_item_id,
  });
}

function scopeForSlot(slot: string): { key: string; label: string } {
  return SLOT_SCOPE[slot] || { key: slot, label: slot.replace(/_/g, ' ') };
}

function toggleArrayValue(values: number[], value: number): number[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

function getWowheadLink(itemId: number, fallbackSpellId?: number): string | undefined {
  if (itemId > 0) return `https://www.wowhead.com/item=${itemId}`;
  if (fallbackSpellId && fallbackSpellId > 0)
    return `https://www.wowhead.com/spell=${fallbackSpellId}`;
  return undefined;
}

function getWowheadData(itemId: number, fallbackSpellId?: number): string | undefined {
  if (itemId > 0) return `item=${itemId}`;
  if (fallbackSpellId && fallbackSpellId > 0) return `spell=${fallbackSpellId}`;
  return undefined;
}

function gemCategoryLabel(category: string): string {
  switch (category) {
    case 'crit':
      return 'Crit-Based';
    case 'haste':
      return 'Haste-Based';
    case 'mast':
      return 'Mast-Based';
    case 'vers':
      return 'Vers-Based';
    default:
      return 'Special';
  }
}

function gemScopeLabel(scope: GemScope): string {
  switch (scope) {
    case 'gear':
      return 'Gear';
    case 'rings':
      return 'Rings';
    case 'neck':
      return 'Neck';
    default:
      return 'All';
  }
}

function groupOrderWeight(groupKey: string): number {
  const orderedGroups = [
    'head',
    'shoulder',
    'chest',
    'legs',
    'feet',
    'rings',
    'main_hand',
    'off_hand',
  ];
  const orderedIndex = orderedGroups.indexOf(groupKey);
  if (orderedIndex >= 0) return orderedIndex;
  return 500;
}

function normalizedSpecName(raw?: string | null): string {
  return (raw || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function isHealerSpec(spec?: string | null): boolean {
  return ['restoration', 'holy', 'discipline', 'mistweaver', 'preservation'].includes(
    normalizedSpecName(spec)
  );
}

function isTankSpec(spec?: string | null): boolean {
  return ['blood', 'protection', 'guardian', 'vengeance', 'brewmaster'].includes(
    normalizedSpecName(spec)
  );
}

function gemFitsSpec(gem: GemDisplay, specName?: string | null): boolean {
  return sharedGemFitsSpec(gem, specName);
}

function enchantFitsSpec(
  enchant: EnchantDisplay,
  className?: string | null,
  specName?: string | null
): boolean {
  return sharedEnchantFitsSpec(enchant, className, specName);
}

function iconBorderClass(quality?: number): string {
  if (quality === 4) return 'border-[#a855f7]/80';
  if (quality === 3) return 'border-sky-400/80';
  return 'border-border';
}

function sortGemOptions(a: GemDisplay, b: GemDisplay): number {
  return sharedSortGemOptions(a, b);
}

function SelectableOptionRow({
  isSelected,
  label,
  sublabel,
  icon,
  leadingIcon,
  quality = 3,
  wowheadHref,
  wowheadData,
  equipped,
  onToggle,
}: SelectableOptionRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggle();
        }
      }}
      className={`flex min-h-[48px] w-full cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-left text-xs font-semibold transition-colors ${
        isSelected
          ? 'border-gold bg-gold/10 text-white shadow-[inset_0_0_0_1px_rgba(214,158,46,0.18)]'
          : 'border-border bg-surface-2 text-zinc-300 hover:border-gold/45 hover:bg-surface'
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {leadingIcon ? (
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-zinc-600 text-zinc-400">
            {leadingIcon}
          </span>
        ) : (
          <a
            href={wowheadHref}
            target="_blank"
            rel="noreferrer"
            data-wowhead={wowheadData}
            className="inline-flex shrink-0 rounded-sm p-0.5"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={`https://render.worldofwarcraft.com/icons/56/${icon}.jpg`}
              alt=""
              className={`h-6 w-6 rounded-sm border ${iconBorderClass(quality)}`}
            />
          </a>
        )}
        <div
          className="min-w-0 max-w-full pr-2"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="truncate">{label}</div>
          {sublabel ? <div className="truncate text-[11px] font-medium text-zinc-500">{sublabel}</div> : null}
        </div>
      </div>
      {equipped ? (
        <span
          title="Equipped"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300"
        >
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M16.704 5.29a1 1 0 010 1.42l-7.25 7.25a1 1 0 01-1.414 0l-3.25-3.25a1 1 0 111.414-1.42l2.543 2.544 6.543-6.544a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      ) : null}
      <span
        aria-hidden="true"
        className={`h-3 w-3 shrink-0 rounded-sm border ${
          isSelected ? 'border-gold bg-gold' : 'border-zinc-600 bg-transparent'
        }`}
      />
    </div>
  );
}

function SkeletonOptionRow() {
  return (
    <div className="flex min-h-[48px] w-full items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
      <div className="h-6 w-6 shrink-0 animate-pulse rounded-sm border border-border bg-white/5" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="h-3.5 w-3/4 animate-pulse rounded bg-white/5" />
      </div>
      <div className="h-3.5 w-3.5 shrink-0 animate-pulse rounded-sm border border-zinc-700 bg-white/5" />
    </div>
  );
}

function SkeletonSectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-4">
      <div>
        <h3 className="text-base font-semibold text-white">{title}</h3>
        <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-7 w-16 animate-pulse rounded-md border border-border bg-white/5" />
        <div className="h-7 w-16 animate-pulse rounded-md border border-border bg-white/5" />
      </div>
    </div>
  );
}

export default function TopGearVariantStudio({
  isOpen,
  onClose,
  items,
  equippedItems = [],
  savedVariantsBySlot = {},
  savedRuleState = null,
  globalAffixesEnabled = false,
  className,
  specName,
  copyEnchants = false,
  onApplyBatch,
  onStateChange,
}: TopGearVariantStudioProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const [rawGems, setRawGems] = useState<RawGem[]>([]);
  const [itemOptionsByUid, setItemOptionsByUid] = useState<Record<string, ItemOptionSet>>({});
  const [groupSelections, setGroupSelections] = useState<Record<string, GroupSelection>>({});
  const [globalGemIds, setGlobalGemIds] = useState<number[]>([]);
  const [includeEmptyGemChoice, setIncludeEmptyGemChoice] = useState(false);
  const [gemSelectionTouched, setGemSelectionTouched] = useState(false);
  const [overrideExistingEnchants, setOverrideExistingEnchants] = useState(false);
  const [overrideExistingGems, setOverrideExistingGems] = useState(false);
  const [gemScope, setGemScope] = useState<GemScope>('all');
  const [showAllGems, setShowAllGems] = useState(false);
  const [showAllEnchants, setShowAllEnchants] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasLoadedOptions, setHasLoadedOptions] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const itemsSignature = useMemo(
    () =>
      items
        .map((item) => `${item.uid}:${item.slot}:${item.item_id}:${item.bonus_ids.join('.')}:${item.season_id}`)
        .sort()
        .join('|'),
    [items]
  );
  const lastLoadedSignatureRef = useRef<string>('');
  const lastInitializedSelectionSignatureRef = useRef<string>('');
  const lastAutoAppliedRuleSignatureRef = useRef<string>('');
  const equippedEnchantIdsByGroup = useMemo(() => {
    const next: Record<string, number[]> = {};
    for (const item of equippedItems) {
      const scope = scopeForSlot(item.slot);
      const enchantId = parseEnchantIdFromItem(item);
      if (enchantId <= 0) continue;
      next[scope.key] = uniqueNumberValues([...(next[scope.key] || []), enchantId]);
    }
    return next;
  }, [equippedItems]);
  const equippedGemIds = useMemo(
    () => uniqueNumberValues(equippedItems.flatMap((item) => parseGemIdsFromItem(item))),
    [equippedItems]
  );
  const copyDefaultsEnabled = copyEnchants && !globalAffixesEnabled;

  const gems = useMemo(
    () => deduplicateGems(rawGems, showAllGems, equippedGemIds),
    [rawGems, showAllGems, equippedGemIds]
  );
  const currentGemExpansion = useMemo(
    () => gems.reduce((max, gem) => (gem.expansion > max ? gem.expansion : max), 0),
    [gems]
  );
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredGems = useMemo(() => {
    const seasonalGems =
      currentGemExpansion > 0 ? gems.filter((gem) => gem.expansion === currentGemExpansion) : gems;
    const nonPvpGems = seasonalGems.filter((gem) => !gem.isPvp);
    return normalizedSearch
      ? nonPvpGems.filter(
          (gem) =>
            gemFitsSpec(gem, specName) &&
            gem.name.toLowerCase().includes(normalizedSearch) ||
            gemFitsSpec(gem, specName) &&
              gem.label.toLowerCase().includes(normalizedSearch)
        )
      : nonPvpGems.filter((gem) => gemFitsSpec(gem, specName));
  }, [gems, currentGemExpansion, normalizedSearch, specName]);
  const gemColumns = useMemo(() => {
    const order = ['special', 'haste', 'crit', 'mast', 'vers'];
    const grouped = new Map<string, GemDisplay[]>();

    for (const gem of filteredGems) {
      const key = gem.category || 'special';
      const list = grouped.get(key) || [];
      list.push(gem);
      grouped.set(key, list);
    }

    return order
      .filter((key) => (grouped.get(key) || []).length > 0)
      .map((key) => ({
        key,
        label: gemCategoryLabel(key),
        gems: (grouped.get(key) || []).sort(sortGemOptions),
      })) as GemColumn[];
  }, [filteredGems]);
  const gemSkeletonColumns = useMemo(
    () => [
      { key: 'special', label: 'Special', rows: 2 },
      { key: 'haste', label: 'Haste-Based', rows: 4 },
      { key: 'crit', label: 'Crit-Based', rows: 4 },
      { key: 'mast', label: 'Mast-Based', rows: 4 },
      { key: 'vers', label: 'Vers-Based', rows: 4 },
    ],
    []
  );
  const gemDisplayById = useMemo(
    () => Object.fromEntries(gems.map((gem) => [gem.gemItemId, gem] as const)),
    [gems]
  );
  const getGemTargetItemsForScope = useCallback(
    (scope: GemScope) =>
      items.filter((item) => {
        const socketCount = Math.max(Number(item.sockets || 0), parseGemIdsFromItem(item).length);
        if (socketCount <= 0) return false;
        switch (scope) {
          case 'gear':
            return item.slot !== 'neck' && item.slot !== 'finger1' && item.slot !== 'finger2';
          case 'rings':
            return item.slot === 'finger1' || item.slot === 'finger2';
          case 'neck':
            return item.slot === 'neck';
          default:
            return true;
        }
      }),
    [items]
  );
  const gemTargetItems = useMemo(() => getGemTargetItemsForScope(gemScope), [gemScope, getGemTargetItemsForScope]);

  useWowheadTooltips([isOpen, items.length, Object.keys(itemOptionsByUid).length, searchTerm]);

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      setLoadError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (items.length === 0) {
      setItemOptionsByUid({});
      setHasLoadedOptions(true);
      setLoading(false);
      lastLoadedSignatureRef.current = '';
      return;
    }

    let cancelled = false;
    const loadSignature = `${className || ''}|${itemsSignature}`;
    if (lastLoadedSignatureRef.current === loadSignature) {
      setHasLoadedOptions(true);
      return;
    }

    const loadOptions = async () => {
      setHasLoadedOptions(false);
      setLoading(true);
      setLoadError(null);
      try {
        const gemsPromise = fetch(`${API_URL}/api/gear/gem-options`, {
          credentials: 'include',
        })
          .then(async (response) => {
            if (!response.ok) return [] as RawGem[];
            return (await response.json()) as RawGem[];
          })
          .catch(() => [] as RawGem[]);

        const itemPromises = items.map(async (item) => {
          try {
            const enchantParams = new URLSearchParams();
            enchantParams.set('slot', item.slot);
            if (className) enchantParams.set('class_name', className);
            if (specName) enchantParams.set('spec', specName);
            if (item.item_id > 0) enchantParams.set('item_id', String(item.item_id));
            if (Array.isArray(item.bonus_ids) && item.bonus_ids.length > 0) {
              enchantParams.set('bonus_ids', item.bonus_ids.join(','));
            }
            if (Number.isFinite(item.season_id) && Number(item.season_id) > 0) {
              enchantParams.set('season_id', String(Number(item.season_id)));
            }

            const enchantsRes = await fetch(
              `${API_URL}/api/gear/enchant-options?${enchantParams.toString()}`,
              {
                credentials: 'include',
              }
            );

            const enchants = enchantsRes.ok
              ? normalizeEnchantOptions((await enchantsRes.json()) as RawEnchant[])
              : [];
            return [item.uid, { enchants }] as const;
          } catch {
            return [item.uid, { enchants: [] }] as const;
          }
        });

        const [gemsData, itemEntries] = await Promise.all([gemsPromise, Promise.all(itemPromises)]);
        if (cancelled) return;

        setRawGems(gemsData);
        setItemOptionsByUid(Object.fromEntries(itemEntries));
        lastLoadedSignatureRef.current = loadSignature;
      } catch {
        if (cancelled) return;
        setLoadError('Could not load variant options.');
      }
      if (!cancelled) {
        setLoading(false);
        setHasLoadedOptions(true);
      }
    };

    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, [className, itemsSignature, specName]);

  const groups = useMemo(() => {
    const byGroup = new Map<string, RuleGroup>();

    for (const item of items) {
      const scope = scopeForSlot(item.slot);
      const existing = byGroup.get(scope.key);
      const optionSet = itemOptionsByUid[item.uid];

      if (!existing) {
        byGroup.set(scope.key, {
          key: scope.key,
          label: scope.label,
          items: [item],
          enchantOptions: optionSet?.enchants || [],
        });
        continue;
      }

      existing.items.push(item);

      const enchantMap = new Map(
        existing.enchantOptions.map((option) => [option.enchantId, option] as const)
      );
      for (const option of optionSet?.enchants || []) {
        enchantMap.set(option.enchantId, option);
      }
      existing.enchantOptions = Array.from(enchantMap.values());
    }

    return Array.from(byGroup.values())
      .filter((group) => group.enchantOptions.length > 0)
      .sort((a, b) => {
        const weightDelta = groupOrderWeight(a.key) - groupOrderWeight(b.key);
        if (weightDelta !== 0) return weightDelta;
        return a.label.localeCompare(b.label);
      });
  }, [itemOptionsByUid, items]);
  const skeletonGroups = useMemo(() => {
    const grouped = new Map<string, SkeletonGroup>();
    for (const item of items) {
      const scope = scopeForSlot(item.slot);
      const existing = grouped.get(scope.key);
      if (existing) {
        existing.itemCount += 1;
        continue;
      }
      grouped.set(scope.key, {
        key: scope.key,
        label: scope.label,
        itemCount: 1,
      });
    }
    return Array.from(grouped.values())
      .sort((a, b) => {
        const weightDelta = groupOrderWeight(a.key) - groupOrderWeight(b.key);
        if (weightDelta !== 0) return weightDelta;
        return a.label.localeCompare(b.label);
      })
      .map((group) => ({
        ...group,
        wide: group.key === 'rings' || group.key === 'main_hand',
      }));
  }, [items]);

  const sanitizedSavedRuleState = useMemo<SavedVariantStudioState | null>(() => {
    if (!savedRuleState) return null;
    const allowedGroupKeys = new Set(groups.map((group) => group.key));
    const nextSelections: Record<string, GroupSelection> = {};
    for (const [groupKey, selection] of Object.entries(savedRuleState.groupSelections || {})) {
      if (!allowedGroupKeys.has(groupKey)) continue;
      nextSelections[groupKey] = {
        enchantIds: uniqueNumberValues(
          Array.isArray(selection.enchantIds) ? selection.enchantIds : []
        ),
        includeNone: Boolean(selection.includeNone),
        touched: Boolean(selection.touched),
      };
    }
    return {
      groupSelections: nextSelections,
      globalGemIds: uniqueNumberValues(
        Array.isArray(savedRuleState.globalGemIds) ? savedRuleState.globalGemIds : []
      ),
      includeEmptyGemChoice: Boolean(savedRuleState.includeEmptyGemChoice),
      gemSelectionTouched: Boolean(savedRuleState.gemSelectionTouched),
      overrideExistingEnchants: Boolean(savedRuleState.overrideExistingEnchants),
      overrideExistingGems: Boolean(savedRuleState.overrideExistingGems),
      gemScope:
        savedRuleState.gemScope === 'gear' ||
        savedRuleState.gemScope === 'rings' ||
        savedRuleState.gemScope === 'neck'
          ? savedRuleState.gemScope
          : 'all',
    };
  }, [groups, savedRuleState]);

  useEffect(() => {
    setGroupSelections((current) => {
      const next: Record<string, GroupSelection> = {};
      for (const group of groups) {
        next[group.key] = current[group.key] || {
          enchantIds: [],
          includeNone: false,
          touched: false,
        };
      }
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);
      if (
        currentKeys.length === nextKeys.length &&
        nextKeys.every((key) => current[key] === next[key])
      ) {
        return current;
      }
      return next;
    });
  }, [groups]);

  const savedSelectionSignature = useMemo(() => {
    const savedRuleParts = sanitizedSavedRuleState
      ? [
          Object.entries(sanitizedSavedRuleState.groupSelections)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(
              ([groupKey, selection]) =>
                `${groupKey}:${selection.enchantIds.join('/')}:${selection.includeNone ? 1 : 0}:${selection.touched ? 1 : 0}`
            )
            .join('|'),
          sanitizedSavedRuleState.globalGemIds.join('/'),
          sanitizedSavedRuleState.includeEmptyGemChoice ? '1' : '0',
          sanitizedSavedRuleState.gemSelectionTouched ? '1' : '0',
          sanitizedSavedRuleState.overrideExistingEnchants ? '1' : '0',
          sanitizedSavedRuleState.overrideExistingGems ? '1' : '0',
          sanitizedSavedRuleState.gemScope,
        ]
      : [];
    const slots = Array.from(
      new Set([...groups.map((group) => group.items[0]?.slot).filter(Boolean) as string[]])
    );
    const parts: string[] = [...savedRuleParts];
    for (const slot of slots) {
      const variants = savedVariantsBySlot[slot] || [];
      for (const item of variants) {
        parts.push(
          `${item.uid}:${item.enchant_id}:${(item.gem_ids || []).join('/')}:${item.force_clear_enchant ? 1 : 0}`
        );
      }
    }
    return parts.sort().join('|');
  }, [groups, sanitizedSavedRuleState, savedVariantsBySlot]);
  const savedRuleStateSignature = useMemo(() => {
    if (!sanitizedSavedRuleState) return '';
    return [
      Object.entries(sanitizedSavedRuleState.groupSelections)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(
          ([groupKey, selection]) =>
            `${groupKey}:${selection.enchantIds.join('/')}:${selection.includeNone ? 1 : 0}:${selection.touched ? 1 : 0}`
        )
        .join('|'),
      sanitizedSavedRuleState.globalGemIds.join('/'),
      sanitizedSavedRuleState.includeEmptyGemChoice ? '1' : '0',
      sanitizedSavedRuleState.gemSelectionTouched ? '1' : '0',
      sanitizedSavedRuleState.overrideExistingEnchants ? '1' : '0',
      sanitizedSavedRuleState.overrideExistingGems ? '1' : '0',
      sanitizedSavedRuleState.gemScope,
    ].join('|');
  }, [sanitizedSavedRuleState]);

  useEffect(() => {
    if (!isOpen || !hasLoadedOptions) return;
    const initSignature = `${itemsSignature}|${savedSelectionSignature}|${copyDefaultsEnabled ? 1 : 0}`;
    if (lastInitializedSelectionSignatureRef.current === initSignature) return;

    if (sanitizedSavedRuleState) {
      const nextGroupSelections: Record<string, GroupSelection> = {};
      for (const group of groups) {
        nextGroupSelections[group.key] = sanitizedSavedRuleState.groupSelections[group.key] || {
          enchantIds: [],
          includeNone: false,
          touched: false,
        };
      }
      setGroupSelections(nextGroupSelections);
      setGlobalGemIds(sanitizedSavedRuleState.globalGemIds);
      setIncludeEmptyGemChoice(sanitizedSavedRuleState.includeEmptyGemChoice);
      setGemSelectionTouched(sanitizedSavedRuleState.gemSelectionTouched);
      setOverrideExistingEnchants(sanitizedSavedRuleState.overrideExistingEnchants);
      setOverrideExistingGems(sanitizedSavedRuleState.overrideExistingGems);
      setGemScope(sanitizedSavedRuleState.gemScope);
      lastInitializedSelectionSignatureRef.current = initSignature;
      return;
    }

    const nextGroupSelections: Record<string, GroupSelection> = {};
    const gemIds = new Set<number>();
    let nextIncludeEmptyGemChoice = false;
    let nextGemSelectionTouched = false;

    for (const group of groups) {
      const variants = group.items.flatMap((item) =>
        (savedVariantsBySlot[item.slot] || []).filter(
          (variant) => buildVariantRuleBaseKey(variant) === buildVariantRuleBaseKey(item)
        )
      );

      if (variants.length === 0) {
        nextGroupSelections[group.key] = {
          enchantIds: [],
          includeNone: false,
          touched: false,
        };
        continue;
      }

      const enchantIds = uniqueNumberValues(
        variants.map((variant) => Number(variant.enchant_id || 0)).filter((id) => id > 0)
      );
      const includeNone = variants.some(
        (variant) => Number(variant.enchant_id || 0) === 0 && Boolean(variant.prevent_copy_enchant || variant.force_clear_enchant)
      );

      nextGroupSelections[group.key] = {
        enchantIds,
        includeNone,
        touched: true,
      };

      for (const variant of variants) {
        const variantGemIds = parseGemIdsFromItem(variant);
        if (variantGemIds.length === 0 && Boolean(variant.prevent_copy_gem)) {
          nextIncludeEmptyGemChoice = true;
          nextGemSelectionTouched = true;
          continue;
        }
        for (const gemId of uniqueNumberValues(variantGemIds)) {
          gemIds.add(gemId);
          nextGemSelectionTouched = true;
        }
      }
    }

    setGroupSelections(nextGroupSelections);
    setGlobalGemIds(Array.from(gemIds));
    setIncludeEmptyGemChoice(nextIncludeEmptyGemChoice);
    setGemSelectionTouched(nextGemSelectionTouched);
    setOverrideExistingEnchants(false);
    setOverrideExistingGems(false);
    setGemScope('all');
    lastInitializedSelectionSignatureRef.current = initSignature;
  }, [copyDefaultsEnabled, groups, hasLoadedOptions, isOpen, itemsSignature, sanitizedSavedRuleState, savedSelectionSignature, savedVariantsBySlot]);

  const effectiveGlobalGemIds = useMemo(
    () => (gemSelectionTouched ? globalGemIds : copyDefaultsEnabled ? equippedGemIds : []),
    [copyDefaultsEnabled, equippedGemIds, gemSelectionTouched, globalGemIds]
  );
  const effectiveIncludeEmptyGemChoice = gemSelectionTouched ? includeEmptyGemChoice : false;
  const getEffectiveGroupSelection = useCallback(
    (groupKey: string): GroupSelection => {
      const current = groupSelections[groupKey];
      if (current?.touched) return current;
      return {
        enchantIds: copyDefaultsEnabled ? equippedEnchantIdsByGroup[groupKey] || [] : [],
        includeNone: false,
        touched: false,
      };
    },
    [copyDefaultsEnabled, equippedEnchantIdsByGroup, groupSelections]
  );

  const buildBundledRequestsForState = useCallback(
    (state: SavedVariantStudioState, applyCopyDefaults: boolean): VariantRequest[] => {
    type ItemChoice = {
      enchantId: number;
      gemIds: number[];
      forceClearEnchant: boolean;
      isBaseline: boolean;
    };

    const requests: VariantRequest[] = [];
    const effectiveStateGemIds = state.gemSelectionTouched
      ? state.globalGemIds
      : applyCopyDefaults
        ? equippedGemIds
        : [];
    const effectiveStateIncludeEmptyGemChoice = state.gemSelectionTouched
      ? state.includeEmptyGemChoice
      : false;

    const compatibleGlobalGemIds = (item: ResolvedItem) =>
      uniqueNumberValues(effectiveStateGemIds).filter((gemId) => {
        const gem = gemDisplayById[gemId];
        if (!gem) return false;
        if (!gemFitsSpec(gem, specName)) return false;
        if (gem.category !== 'special') return true;
        return item.slot === 'neck';
      });

    const gemTargetUidSet = new Set(
      getGemTargetItemsForScope(state.gemScope).map((item) => item.uid)
    );

    const itemChoices: { item: ResolvedItem; choices: ItemChoice[] }[] = [];

    for (const item of items) {
      const groupKey = scopeForSlot(item.slot).key;
      const rawSelection = state.groupSelections[groupKey];
      const selection: GroupSelection =
        rawSelection?.touched
          ? rawSelection
          : {
              enchantIds: applyCopyDefaults ? equippedEnchantIdsByGroup[groupKey] || [] : [],
              includeNone: false,
              touched: false,
            };
      const optionSet = itemOptionsByUid[item.uid];
      const currentEnchantId = parseEnchantIdFromItem(item);
      const currentGemIds = parseGemIdsFromItem(item);
      const socketCount = Math.max(Number(item.sockets || 0), currentGemIds.length);

      const supportedEnchantIds = new Set(
        (optionSet?.enchants || []).map((option) => option.enchantId)
      );
      const explicitEnchantChoices = selection.touched
        ? uniqueNumberValues(selection.enchantIds).filter((enchantId) =>
            supportedEnchantIds.has(enchantId)
          )
        : [];

      let enchantChoices: number[] = [currentEnchantId];
      if (selection.touched) {
        if (selection.includeNone) {
          enchantChoices = [0];
        } else if (
          (currentEnchantId === 0 || state.overrideExistingEnchants) &&
          explicitEnchantChoices.length > 0
        ) {
          enchantChoices = explicitEnchantChoices;
        }
      }

      let gemChoices: number[][] = [currentGemIds];
      if (state.gemSelectionTouched && socketCount > 0 && gemTargetUidSet.has(item.uid)) {
        if (effectiveStateIncludeEmptyGemChoice) {
          gemChoices = [[]];
        } else if (currentGemIds.length === 0 || state.overrideExistingGems) {
          gemChoices = compatibleGlobalGemIds(item).map((gemId) =>
            buildSocketGemArray(socketCount, gemId)
          );
          if (gemChoices.length === 0) {
            gemChoices = [currentGemIds];
          }
        }
      }

      const seen = new Set<string>();
      const choices: ItemChoice[] = [
        {
          enchantId: currentEnchantId,
          gemIds: currentGemIds,
          forceClearEnchant: false,
          isBaseline: true,
        },
      ];

      for (const enchantId of enchantChoices) {
        for (const gemIds of gemChoices) {
          if (enchantId === currentEnchantId && sameNumberArray(gemIds, currentGemIds)) {
            continue;
          }
          const key = `${item.uid}|${enchantId}|${gemIds.join('/')}`;
          if (seen.has(key)) continue;
          seen.add(key);
          choices.push({
            enchantId,
            gemIds,
            forceClearEnchant: enchantId === 0,
            isBaseline: false,
          });
        }
      }

      if (choices.length > 1) {
        itemChoices.push({ item, choices });
      }
    }

    if (itemChoices.length === 0) {
      return requests;
    }

    let bundles: { item: ResolvedItem; choice: ItemChoice }[][] = [[]];
    for (const entry of itemChoices) {
      const nextBundles: { item: ResolvedItem; choice: ItemChoice }[][] = [];
      for (const bundle of bundles) {
        for (const choice of entry.choices) {
          nextBundles.push([...bundle, { item: entry.item, choice }]);
        }
      }
      bundles = nextBundles;
    }

    const seenBundleSignatures = new Set<string>();
    bundles.forEach((bundle, bundleIndex) => {
      const changedEntries = bundle.filter((entry) => !entry.choice.isBaseline);
      if (changedEntries.length === 0) return;

      const bundleSignature = changedEntries
        .map(
          ({ item, choice }) =>
            `${item.uid}|${choice.enchantId}|${choice.gemIds.join('/')}|${choice.forceClearEnchant ? 1 : 0}`
        )
        .join('||');
      if (seenBundleSignatures.has(bundleSignature)) return;
      seenBundleSignatures.add(bundleSignature);

      const bundleId = String(bundleIndex + 1);
      for (const { item, choice } of changedEntries) {
        requests.push({
          item,
          enchantId: choice.enchantId,
          gemIds: choice.gemIds,
          embellishment: null,
          forceClearEnchant: choice.forceClearEnchant,
          bundleId,
        });
      }
    });

      return requests;
    },
    [
      equippedEnchantIdsByGroup,
      equippedGemIds,
      gemDisplayById,
      getGemTargetItemsForScope,
      itemOptionsByUid,
      items,
      specName,
    ]
  );

  const buildBundledRequests = useCallback(
    (): VariantRequest[] =>
      buildBundledRequestsForState(
        {
          groupSelections,
          globalGemIds,
          includeEmptyGemChoice,
          gemSelectionTouched,
          overrideExistingEnchants,
          overrideExistingGems,
          gemScope,
        },
        copyDefaultsEnabled
      ),
    [
      buildBundledRequestsForState,
      copyDefaultsEnabled,
      gemScope,
      gemSelectionTouched,
      globalGemIds,
      groupSelections,
      includeEmptyGemChoice,
      overrideExistingEnchants,
      overrideExistingGems,
    ]
  );

  const socketableItemCount = gemTargetItems.length;
  const isLoadingState = loading || (isOpen && items.length > 0 && !hasLoadedOptions);
  const hasVisibleGemOptions = gemColumns.some((column) => column.gems.length > 0);
  useEffect(() => {
    if (
      isOpen ||
      !globalAffixesEnabled ||
      loading ||
      !hasLoadedOptions ||
      !sanitizedSavedRuleState
    ) {
      lastAutoAppliedRuleSignatureRef.current = '';
      return;
    }

    const autoApplySignature = `${itemsSignature}|${savedRuleStateSignature}`;
    if (lastAutoAppliedRuleSignatureRef.current === autoApplySignature) return;
    lastAutoAppliedRuleSignatureRef.current = autoApplySignature;

    onApplyBatch(buildBundledRequestsForState(sanitizedSavedRuleState, false));
  }, [
    buildBundledRequestsForState,
    globalAffixesEnabled,
    hasLoadedOptions,
    isOpen,
    itemsSignature,
    loading,
    onApplyBatch,
    sanitizedSavedRuleState,
    savedRuleStateSignature,
  ]);

  const commitAndClose = useCallback(() => {
    const requests = buildBundledRequests();
    onStateChange?.({
      groupSelections,
      globalGemIds,
      includeEmptyGemChoice,
      gemSelectionTouched,
      overrideExistingEnchants,
      overrideExistingGems,
      gemScope,
    });
    onApplyBatch(requests);
    onClose();
  }, [
    buildBundledRequests,
    gemSelectionTouched,
    globalGemIds,
    groupSelections,
    includeEmptyGemChoice,
    onApplyBatch,
    onClose,
    onStateChange,
    overrideExistingEnchants,
    overrideExistingGems,
    gemScope,
  ]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') commitAndClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commitAndClose, isOpen]);

  function updateSelection(groupKey: string, value: number) {
    setGroupSelections((current) => {
      const existing = current[groupKey] || {
        enchantIds: [],
        includeNone: false,
        touched: false,
      };
      const baseEnchantIds = existing.touched
        ? existing.enchantIds
        : copyDefaultsEnabled
          ? equippedEnchantIdsByGroup[groupKey] || []
          : [];
      return {
        ...current,
        [groupKey]: {
          enchantIds: toggleArrayValue(baseEnchantIds, value),
          includeNone: existing.touched ? existing.includeNone : false,
          touched: true,
        },
      };
    });
  }

  function updateGlobalGemSelection(value: number) {
    setGemSelectionTouched(true);
    setGlobalGemIds((current) => {
      const base = gemSelectionTouched ? current : copyDefaultsEnabled ? effectiveGlobalGemIds : current;
      return base.includes(value) ? base.filter((entry) => entry !== value) : [...base, value];
    });
  }

  function toggleEmptyGemChoice() {
    setGemSelectionTouched(true);
    setIncludeEmptyGemChoice((current) => !current);
  }

  function selectEquippedGems() {
    setGemSelectionTouched(true);
    setGlobalGemIds(equippedGemIds);
    setIncludeEmptyGemChoice(false);
  }

  function toggleGroupNone(groupKey: string) {
    setGroupSelections((current) => {
      const existing = current[groupKey] || {
        enchantIds: [],
        includeNone: false,
        touched: false,
      };
      return {
        ...current,
        [groupKey]: {
          enchantIds: existing.touched
            ? existing.enchantIds
            : copyDefaultsEnabled
              ? equippedEnchantIdsByGroup[groupKey] || []
              : [],
          includeNone: !(existing.touched ? existing.includeNone : false),
          touched: true,
        },
      };
    });
  }

  function resetGroup(groupKey: string) {
    setGroupSelections((current) => ({
      ...current,
      [groupKey]: {
        enchantIds: [],
        includeNone: false,
        touched: false,
      },
    }));
  }

  function selectAllGroupEnchants(groupKey: string, enchantIds: number[]) {
    setGroupSelections((current) => ({
      ...current,
      [groupKey]: {
        enchantIds: uniqueNumberValues(enchantIds),
        includeNone: false,
        touched: true,
      },
    }));
  }

  function resetGemSelection() {
    setGlobalGemIds([]);
    setIncludeEmptyGemChoice(false);
    setGemSelectionTouched(false);
  }

  function resetAllGearSelections() {
    setGroupSelections(() => {
      const next: Record<string, GroupSelection> = {};
      for (const group of groups) {
        next[group.key] = {
          enchantIds: [],
          includeNone: false,
          touched: false,
        };
      }
      return next;
    });
  }

  function selectEquippedEnchants() {
    setGroupSelections(() => {
      const next: Record<string, GroupSelection> = {};
      for (const group of groups) {
        const equippedIds = equippedEnchantIdsByGroup[group.key] || [];
        next[group.key] = {
          enchantIds: equippedIds,
          includeNone: equippedIds.length === 0,
          touched: true,
        };
      }
      return next;
    });
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={commitAndClose} />

      <div
        ref={modalRef}
        className="relative flex h-[92vh] w-full max-w-[min(96vw,1700px)] flex-col overflow-hidden rounded-2xl border border-border bg-bg shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-border bg-surface/80 px-6 py-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-zinc-500">
              Enchant & Gem Rules
            </p>
            <h2 className="mt-2 text-xl font-semibold text-white">
              Manage enchants and gems for included gear
            </h2>
          </div>
          <button
            type="button"
            onClick={commitAndClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2 text-zinc-500 transition-all hover:border-zinc-500 hover:bg-white/5 hover:text-white"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-zinc-400">
              {groups.length} group{groups.length === 1 ? '' : 's'} available across {items.length}{' '}
              included item{items.length === 1 ? '' : 's'}
            </div>
            <div className="relative w-full md:max-w-md">
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Filter enchants and gems"
                className="h-10 w-full rounded-lg border border-border bg-surface-2 pl-10 pr-3 text-sm text-white placeholder:text-zinc-500 focus:border-gold/40 focus:outline-none"
              />
              <svg
                className="absolute left-3 top-3 h-4 w-4 text-zinc-500"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
          </div>

          {groups.length === 0 && items.length === 0 ? (
            <div className="rounded-2xl border border-border/70 bg-surface-2/50 px-5 py-8 text-sm text-zinc-400">
              {isLoadingState
                ? 'Loading compatible options...'
                : 'No equipped or selected Top Gear items currently expose enchant or gem rules.'}
            </div>
          ) : (
            <div className="space-y-4">
              <section className="rounded-2xl border border-border bg-surface-2/40 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-white">Gems</h3>
                      <p className="mt-1 text-sm text-gold">
                        Scope: {gemScopeLabel(gemScope)}.
                        {' '}
                        Applies to {socketableItemCount} targeted socketed item
                        {socketableItemCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="inline-flex items-center rounded-md border border-border bg-surface-2 p-0.5">
                        {(['all', 'rings', 'neck', 'gear'] as GemScope[]).map((scope) => (
                          <button
                            key={scope}
                            type="button"
                            onClick={() => setGemScope(scope)}
                            className={`rounded px-2 py-1 text-xs font-semibold transition-colors ${
                              gemScope === scope
                                ? 'bg-gold/[0.14] text-gold'
                                : 'text-zinc-300 hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            {gemScopeLabel(scope)}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={selectEquippedGems}
                        className="rounded-md border border-gold/45 bg-gold/[0.12] px-2.5 py-1 text-xs font-semibold text-gold transition-colors hover:bg-gold/[0.2]"
                      >
                        Select Equipped
                      </button>
                      <label className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold text-zinc-300">
                        <input
                          type="checkbox"
                          checked={showAllGems}
                          onChange={(event) => setShowAllGems(event.target.checked)}
                          className="h-3.5 w-3.5 rounded border-border bg-surface-2 accent-gold"
                        />
                        <span>Show all gems</span>
                      </label>
                      <label className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold text-zinc-300">
                        <input
                          type="checkbox"
                          checked={overrideExistingGems}
                          onChange={(event) => setOverrideExistingGems(event.target.checked)}
                          className="h-3.5 w-3.5 rounded border-border bg-surface-2 accent-gold"
                        />
                        <span>Include existing items</span>
                      </label>
                      <button
                        type="button"
                        onClick={resetGemSelection}
                        className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[12px] font-semibold text-zinc-300 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="mt-4">
                    {isLoadingState ? (
                      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
                        {gemSkeletonColumns.map((column) => (
                          <div key={`gem-skeleton-${column.key}`} className="space-y-2">
                            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                              {column.label}
                            </div>
                            {Array.from({ length: column.rows }, (_, index) => (
                              <SkeletonOptionRow key={`${column.key}-row-${index}`} />
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : hasVisibleGemOptions ? (
                      <div className="space-y-3">
                        <SelectableOptionRow
                          isSelected={effectiveIncludeEmptyGemChoice}
                          label="Empty Socket"
                          icon="inv_misc_questionmark"
                          leadingIcon={<CircleX className="h-3.5 w-3.5" />}
                          onToggle={toggleEmptyGemChoice}
                        />
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
                        {gemColumns.map((column) => (
                          <div key={column.key} className="space-y-2">
                            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                              {column.label}
                            </div>
                            {column.gems.map((option) => (
                              <SelectableOptionRow
                                key={`global-gem-${option.gemItemId}`}
                                isSelected={effectiveGlobalGemIds.includes(option.gemItemId)}
                                label={option.name}
                                sublabel={option.label}
                                icon={option.icon}
                                quality={option.quality}
                                wowheadHref={`https://www.wowhead.com/item=${option.gemItemId}`}
                                wowheadData={`item=${option.gemItemId}`}
                                equipped={equippedGemIds.includes(option.gemItemId)}
                                onToggle={() => updateGlobalGemSelection(option.gemItemId)}
                              />
                            ))}
                          </div>
                        ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-zinc-500">
                        {loadError || 'No gem options are available right now.'}
                      </div>
                    )}
                  </div>
                </section>

              <section className="rounded-2xl border border-border bg-surface-2/40 p-4">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white">Gear</h3>
                    <p className="mt-1 text-sm text-zinc-400">Applies to the included gear.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={selectEquippedEnchants}
                      className="rounded-md border border-gold/45 bg-gold/[0.12] px-2.5 py-1 text-xs font-semibold text-gold transition-colors hover:bg-gold/[0.2]"
                    >
                      Select Equipped
                    </button>
                    <label className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold text-zinc-300">
                      <input
                        type="checkbox"
                        checked={showAllEnchants}
                        onChange={(event) => setShowAllEnchants(event.target.checked)}
                        className="h-3.5 w-3.5 rounded border-border bg-surface-2 accent-gold"
                      />
                      <span>Show all enchants</span>
                    </label>
                    <label className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold text-zinc-300">
                      <input
                        type="checkbox"
                        checked={overrideExistingEnchants}
                        onChange={(event) => setOverrideExistingEnchants(event.target.checked)}
                        className="h-3.5 w-3.5 rounded border-border bg-surface-2 accent-gold"
                      />
                      <span>Include existing items</span>
                    </label>
                    <button
                      type="button"
                      onClick={resetAllGearSelections}
                      className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[12px] font-semibold text-zinc-300 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {isLoadingState ? (
                  <div className="grid grid-cols-1 gap-x-6 gap-y-6 xl:grid-cols-4 2xl:grid-cols-5">
                    {skeletonGroups.map((group) => (
                      <section
                        key={`skeleton-${group.key}`}
                        className={`min-w-0 ${group.wide ? 'xl:col-span-2' : ''}`}
                      >
                        <SkeletonSectionHeader
                          title={group.label}
                          subtitle={`${group.itemCount} included ${group.key === 'main_hand' ? 'weapon' : 'item'}${group.itemCount === 1 ? '' : 's'}`}
                        />
                        <div className={`grid gap-2 ${group.wide ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
                          <div className="space-y-2">
                            <SkeletonOptionRow />
                            <SkeletonOptionRow />
                            <SkeletonOptionRow />
                          </div>
                          {group.wide ? (
                            <div className="space-y-2">
                              <SkeletonOptionRow />
                              <SkeletonOptionRow />
                              <SkeletonOptionRow />
                            </div>
                          ) : null}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : groups.length === 0 ? (
                  <div className="text-sm text-zinc-500">
                    {loadError || 'No enchant options are available right now.'}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-x-6 gap-y-6 xl:grid-cols-4 2xl:grid-cols-5">
                    {groups.map((group) => {
                      const selection = getEffectiveGroupSelection(group.key);
                      const pinnedEnchantIds = uniqueNumberValues([
                        ...group.items.map(parseEnchantIdFromItem),
                        ...(equippedEnchantIdsByGroup[group.key] || []),
                        ...selection.enchantIds,
                      ]);
                      const visibleEnchants = deduplicateEnchants(
                        group.enchantOptions,
                        showAllEnchants,
                        pinnedEnchantIds
                      ).filter((option) => enchantFitsSpec(option, className, specName));
                      const filteredEnchants = normalizedSearch
                        ? visibleEnchants.filter((option) =>
                            option.name.toLowerCase().includes(normalizedSearch)
                          )
                        : visibleEnchants;
                      if (filteredEnchants.length === 0) return null;
                      const enchantOverflowLimit = showAllEnchants ? 10 : 5;
                      const columns =
                        filteredEnchants.length > enchantOverflowLimit
                          ? [
                              filteredEnchants.slice(0, enchantOverflowLimit),
                              filteredEnchants.slice(enchantOverflowLimit),
                            ]
                          : [filteredEnchants];
                      const equippedEnchantIds = equippedEnchantIdsByGroup[group.key] || [];

                      return (
                        <section
                          key={group.key}
                          className={`min-w-0 ${columns.length > 1 ? 'xl:col-span-2' : ''}`}
                        >
                          <div className="mb-3 flex items-start justify-between gap-4">
                            <div>
                              <h3 className="text-base font-semibold text-white">{group.label}</h3>
                              <p className="mt-1 text-xs text-zinc-500">
                                {group.items.length} included {group.key === 'main_hand' ? 'weapon' : 'item'}
                                {group.items.length === 1 ? '' : 's'}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  selectAllGroupEnchants(
                                    group.key,
                                    filteredEnchants.map((option) => option.enchantId)
                                  )
                                }
                                className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[12px] font-semibold text-zinc-300 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white"
                              >
                                Select All
                              </button>
                              <button
                                type="button"
                                onClick={() => resetGroup(group.key)}
                                className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[12px] font-semibold text-zinc-300 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white"
                              >
                                Clear
                              </button>
                            </div>
                          </div>

                          <div
                            className={`grid gap-2 ${
                              columns.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'
                            }`}
                          >
                            {columns.map((column, columnIndex) => (
                              <div key={`${group.key}-column-${columnIndex}`} className="space-y-2">
                                {columnIndex === 0 ? (
                                  <SelectableOptionRow
                                    isSelected={selection.includeNone}
                                    label="No Enchant"
                                    icon="inv_misc_questionmark"
                                    leadingIcon={<CircleX className="h-3.5 w-3.5" />}
                                    onToggle={() => toggleGroupNone(group.key)}
                                  />
                                ) : null}
                                {column.map((option) => (
                                  <SelectableOptionRow
                                    key={`${group.key}-enchant-${option.enchantId}`}
                                    isSelected={selection.enchantIds.includes(option.enchantId)}
                                    label={option.name}
                                    icon={option.icon}
                                    quality={option.quality}
                                    wowheadHref={getWowheadLink(option.itemId, option.enchantId)}
                                    wowheadData={getWowheadData(option.itemId, option.enchantId)}
                                    equipped={equippedEnchantIds.includes(option.enchantId)}
                                    onToggle={() => updateSelection(group.key, option.enchantId)}
                                  />
                                ))}
                              </div>
                            ))}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end border-t border-border bg-surface/70 px-6 py-4">
          <button
            type="button"
            onClick={commitAndClose}
            className="rounded-md border border-gold/55 bg-gold/[0.16] px-4 py-2 text-sm font-semibold text-gold transition-colors hover:bg-gold/[0.24]"
          >
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
}
