'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleX, Search, X } from 'lucide-react';
import { API_URL } from '../lib/api';
import type { ResolvedItem } from '../lib/types';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import { useDismissOnOutside } from '../lib/useDismissOnOutside';
import {
  deduplicateEnchants,
  deduplicateGems,
  enchantFitsSpec,
  gemFitsSpec,
  normalizeEnchantOptions,
  type RawEnchantOption,
  type RawGemOption,
  sortGemOptions,
} from './top-gear/affixOptionUtils';

/** Raw enchant shape returned by the backend (straight from enchantments.json). */
interface RawEnchant extends RawEnchantOption {
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
}

/** Raw gem shape returned by the backend (straight from enchantments.json, slot=socket). */
interface RawGem extends RawGemOption {
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
}

interface EmbellishmentOption {
  id: number;
  item_id: number;
  name: string;
  icon: string;
  quality: number;
  bonus_ids: number[];
}

interface OptimizeItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: ResolvedItem | null;
  className?: string | null;
  specName?: string | null;
  globalAffixesEnabled?: boolean;
  onApply: (
    enchantId: number,
    gemIds: number[],
    embellishment: EmbellishmentOption | null
  ) => void;
}

interface LoadingSectionProps {
  title: string;
  rows?: number;
  showToggle?: boolean;
}

const enchantOptionsCache = new Map<string, RawEnchant[]>();
let gemOptionsCache: RawGem[] | null = null;
const embellishmentOptionsCache = new Map<number, EmbellishmentOption[]>();

function normalizeEnchantQuerySlot(slot: string): string {
  if (slot === 'finger1' || slot === 'finger2') return 'finger';
  if (slot === 'trinket1' || slot === 'trinket2') return 'trinket';
  return slot;
}

function getEnchantCacheKey(
  item: ResolvedItem,
  className?: string | null,
  specName?: string | null
): string {
  return [
    normalizeEnchantQuerySlot(item.slot),
    className || '',
    specName || '',
    item.item_id || 0,
    Number(item.season_id) || 0,
    Array.isArray(item.bonus_ids) ? [...item.bonus_ids].sort((a, b) => a - b).join(',') : '',
  ].join('|');
}

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

function getInitialEnchantSelection(item: ResolvedItem | null): number {
  return item?.enchant_id || 0;
}

function getInitialGemSelections(item: ResolvedItem | null): number[] {
  const itemGemIds = parseGemIdsFromItem(item);
  const socketCount = Math.max(Number(item?.sockets || 0), itemGemIds.length);
  return Array.from({ length: socketCount }, (_, index) => itemGemIds[index] || 0);
}

function getInitialEmbellishmentSelection(item: ResolvedItem | null): number {
  return item?.embellishment_item_id || 0;
}

function LoadingSection({ title, rows = 4, showToggle = false }: LoadingSectionProps) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted">{title}</h3>
        {showToggle ? (
          <div className="h-7 w-32 rounded-md border border-border bg-surface-2/70" />
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={`${title}-loading-${index}`}
            className="flex animate-pulse items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3"
          >
            <div className="h-8 w-8 rounded border border-white/5 bg-white/10" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-3/4 rounded bg-white/10" />
              <div className="h-2 w-1/3 rounded bg-white/5" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function LoadingOptionCard({
  label,
  sublabel,
  icon,
}: {
  label: string;
  sublabel?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3 text-left text-gray-400">
      <div className="flex h-8 w-8 items-center justify-center rounded border border-white/5 bg-black/20 text-muted">
        {icon ?? <div className="h-4 w-4 rounded bg-white/10" />}
      </div>
      <div>
        <div className="text-[13px] font-bold">{label}</div>
        {sublabel ? <div className="mt-0.5 text-[10px] text-muted">{sublabel}</div> : null}
      </div>
    </div>
  );
}

function LoadingSkeletonOptionCards({ rows = 3 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={`loading-option-${index}`}
          className="flex animate-pulse items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3"
        >
          <div className="h-8 w-8 rounded border border-white/5 bg-white/10" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-3/4 rounded bg-white/10" />
            <div className="h-2 w-1/3 rounded bg-white/5" />
          </div>
        </div>
      ))}
    </>
  );
}

function getEnchantSectionMinHeight(slot: string): string {
  if (slot === 'finger1' || slot === 'finger2' || slot === 'neck') {
    return 'min-h-[260px]';
  }
  if (slot === 'main_hand' || slot === 'off_hand') {
    return 'min-h-[320px]';
  }
  return 'min-h-[180px]';
}

function getSocketSectionMinHeight(socketCount: number, slot: string): string {
  if (socketCount <= 0) return '';
  if (slot === 'finger1' || slot === 'finger2' || slot === 'neck') {
    return 'min-h-[430px]';
  }
  if (socketCount > 1) {
    return 'min-h-[520px]';
  }
  return 'min-h-[360px]';
}

export default function OptimizeItemModal({
  isOpen,
  onClose,
  item,
  className,
  specName,
  globalAffixesEnabled = false,
  onApply,
}: OptimizeItemModalProps) {
  const [rawEnchants, setRawEnchants] = useState<RawEnchant[]>([]);
  const [rawGems, setRawGems] = useState<RawGem[]>([]);
  const [rawEmbellishments, setRawEmbellishments] = useState<EmbellishmentOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAllEnchants, setShowAllEnchants] = useState(false);
  const [showAllGems, setShowAllGems] = useState(false);
  const [selectedEnchant, setSelectedEnchant] = useState<number>(() => getInitialEnchantSelection(item));
  const [selectedGemIds, setSelectedGemIds] = useState<number[]>(() => getInitialGemSelections(item));
  const [selectedEmbellishment, setSelectedEmbellishment] = useState<number>(() => getInitialEmbellishmentSelection(item));
  const [searchTerm, setSearchTerm] = useState('');
  const modalRef = useRef<HTMLDivElement | null>(null);
  const fetchRequestRef = useRef(0);

  // Derive display lists from raw data
  const enchants = useMemo(
    () =>
      deduplicateEnchants(normalizeEnchantOptions(rawEnchants), showAllEnchants).filter((enchant) =>
        enchantFitsSpec(enchant, className, specName)
      ),
    [className, rawEnchants, showAllEnchants, specName]
  );
  const gems = useMemo(
    () =>
      deduplicateGems(rawGems, showAllGems)
        .filter((gem) => !gem.isPvp)
        .filter((gem) => gemFitsSpec(gem, specName))
        .sort(sortGemOptions),
    [rawGems, showAllGems, specName]
  );
  const embellishments = useMemo(() => rawEmbellishments, [rawEmbellishments]);
  useWowheadTooltips([isOpen, enchants.length, gems.length, embellishments.length, searchTerm]);

  useEffect(() => {
    if (isOpen && item) {
      const requestId = ++fetchRequestRef.current;
      const enchantCacheKey = getEnchantCacheKey(item, className, specName);
      const cachedEnchants = enchantOptionsCache.get(enchantCacheKey);
      const cachedGems = gemOptionsCache;
      const cachedEmbellishments = embellishmentOptionsCache.get(item.item_id);
      const hasCachedOptions =
        cachedEnchants !== undefined &&
        cachedGems !== null &&
        cachedEmbellishments !== undefined;

      setLoading(!hasCachedOptions);
      setRawEnchants(cachedEnchants || []);
      setRawGems(cachedGems || []);
      setRawEmbellishments(cachedEmbellishments || []);
      setSelectedEnchant(getInitialEnchantSelection(item));
      setSelectedGemIds(getInitialGemSelections(item));
      setSelectedEmbellishment(getInitialEmbellishmentSelection(item));
      setShowAllEnchants(false);
      setShowAllGems(false);
      setSearchTerm('');
      if (!hasCachedOptions) {
        void fetchOptions(item, requestId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, item, className, specName]);
  useDismissOnOutside(modalRef, isOpen, onClose);

  async function fetchOptions(currentItem: ResolvedItem, requestId: number) {
    try {
      const enchantCacheKey = getEnchantCacheKey(currentItem, className, specName);
      const enchantParams = new URLSearchParams();
      enchantParams.set('slot', normalizeEnchantQuerySlot(currentItem.slot));
      if (className) enchantParams.set('class_name', className);
      if (specName) enchantParams.set('spec', specName);
      if (currentItem.item_id > 0) enchantParams.set('item_id', String(currentItem.item_id));
      if (Array.isArray(currentItem.bonus_ids) && currentItem.bonus_ids.length > 0) {
        enchantParams.set('bonus_ids', currentItem.bonus_ids.join(','));
      }
      if (Number.isFinite(currentItem.season_id) && Number(currentItem.season_id) > 0) {
        enchantParams.set('season_id', String(Number(currentItem.season_id)));
      }
      const [enchantsRes, gemsRes, embellishmentsRes] = await Promise.all([
        fetch(`${API_URL}/api/gear/enchant-options?${enchantParams.toString()}`, {
          credentials: 'include',
        }),
        fetch(`${API_URL}/api/gear/gem-options`, { credentials: 'include' }),
        fetch(
          `${API_URL}/api/gear/embellishment-options?item_id=${encodeURIComponent(String(currentItem.item_id))}`,
          { credentials: 'include' }
        ),
      ]);
      if (fetchRequestRef.current !== requestId) return;
      if (enchantsRes.ok) {
        const nextEnchants = (await enchantsRes.json()) as RawEnchant[];
        enchantOptionsCache.set(enchantCacheKey, nextEnchants);
        setRawEnchants(nextEnchants);
      }
      if (gemsRes.ok) {
        const nextGems = (await gemsRes.json()) as RawGem[];
        gemOptionsCache = nextGems;
        setRawGems(nextGems);
      }
      if (embellishmentsRes.ok) {
        const options = (await embellishmentsRes.json()) as EmbellishmentOption[];
        embellishmentOptionsCache.set(currentItem.item_id, options);
        setRawEmbellishments(options);
      } else {
        embellishmentOptionsCache.set(currentItem.item_id, []);
        setRawEmbellishments([]);
      }
    } catch (e) {
      if (fetchRequestRef.current !== requestId) return;
      console.error('Failed to fetch optimization options', e);
      setRawEmbellishments([]);
    }
    if (fetchRequestRef.current === requestId) {
      setLoading(false);
    }
  }

  const currentGemExpansion = useMemo(
    () => gems.reduce((max, g) => (g.expansion > max ? g.expansion : max), 0),
    [gems]
  );
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredEnchants = useMemo(
    () =>
      normalizedSearch
        ? enchants.filter((e) => e.name.toLowerCase().includes(normalizedSearch))
        : enchants,
    [enchants, normalizedSearch]
  );
  const seasonalGems = useMemo(
    () =>
      currentGemExpansion > 0
        ? gems.filter((g) => g.expansion === currentGemExpansion)
        : gems,
    [gems, currentGemExpansion]
  );
  const filteredGems = useMemo(
    () =>
      normalizedSearch
        ? seasonalGems.filter(
            (g) =>
              g.name.toLowerCase().includes(normalizedSearch) ||
              g.label.toLowerCase().includes(normalizedSearch)
          )
        : seasonalGems,
    [seasonalGems, normalizedSearch]
  );
  const filteredEmbellishments = useMemo(
    () =>
      normalizedSearch
        ? embellishments.filter((emb) => emb.name.toLowerCase().includes(normalizedSearch))
        : embellishments,
    [embellishments, normalizedSearch]
  );
  const socketCount = Math.max(Number(item?.sockets || 0), parseGemIdsFromItem(item).length);
  const currentSlot = item?.slot || '';
  const enchantSectionMinHeight = getEnchantSectionMinHeight(currentSlot);
  const socketSectionMinHeight = getSocketSectionMinHeight(socketCount, currentSlot);
  const hasEnchantSection = !globalAffixesEnabled && enchants.length > 0;
  const hasSocketSection = !globalAffixesEnabled && socketCount > 0;
  const hasEmbellishmentSection = embellishments.length > 0;
  const showSearch = hasEnchantSection || hasSocketSection || hasEmbellishmentSection;
  const showLoadingEnchantSection = loading && !globalAffixesEnabled;
  const showLoadingSocketSection = loading && !globalAffixesEnabled && socketCount > 0;
  const showLoadingEmbellishmentSection = loading;
  const showLoadingSearch =
    loading && (showLoadingEnchantSection || showLoadingSocketSection || showLoadingEmbellishmentSection);

  if (!isOpen || !item) return null;

  function handleApply() {
    const selected =
      embellishments.find((opt) => opt.item_id === selectedEmbellishment) || null;
    onApply(
      selectedEnchant,
      selectedGemIds.filter((gemId) => Number.isFinite(gemId) && gemId > 0),
      selected
    );
  }

  function setSocketGem(socketIndex: number, gemItemId: number) {
    setSelectedGemIds((current) => {
      const next = Array.from(
        { length: Math.max(socketCount, current.length) },
        (_, index) => current[index] || 0
      );
      next[socketIndex] = gemItemId;
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      <div
        ref={modalRef}
        className="relative flex h-[70vh] min-h-[540px] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/10 bg-surface shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="relative h-10 w-10">
              <img
                src={`https://render.worldofwarcraft.com/icons/56/${item.icon}.jpg`}
                alt=""
                className="h-full w-full rounded-md border border-white/10"
              />
              <div
                className="absolute inset-0 rounded-md ring-1 ring-inset ring-white/10"
                style={{ boxShadow: `0 0 10px ${item.quality_color}40` }}
              />
            </div>
            <div>
              <h2
                className="text-lg font-bold tracking-tight"
                style={{ color: item.quality_color }}
              >
                {item.name}
              </h2>
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">
                {globalAffixesEnabled ? 'Embellishment' : 'Optimization'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/5 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="space-y-8">
            {globalAffixesEnabled && (
              <section>
                <div className="rounded-lg border border-border bg-surface-2/50 px-4 py-3 text-sm text-zinc-400">
                  Enchants and gems are controlled by Enchant & Gem Rules while Global Enchants & Gems is enabled.
                </div>
              </section>
            )}
            {(showSearch || showLoadingSearch) && (
              <section>
                <div className="relative">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search enchants, gems, embellishments..."
                    disabled={loading}
                    className="h-9 w-full rounded-md bg-white/5 pl-9 pr-3 text-sm text-white placeholder-gray-500 ring-1 ring-white/10 focus:bg-white/10 focus:outline-none focus:ring-gold/50"
                  />
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
                </div>
              </section>
            )}

            {showLoadingEnchantSection && (
              <section className={enchantSectionMinHeight}>
                <div className="mb-4 flex items-center justify-between gap-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted">
                    Enchantment
                  </h3>
                  <div className="h-7 w-32 rounded-md border border-border bg-surface-2/70" />
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <LoadingOptionCard label="No Enchant" icon={<CircleX className="h-4 w-4" />} />
                  <LoadingSkeletonOptionCards rows={3} />
                </div>
              </section>
            )}

            {/* Enchant Selection */}
            {!loading && hasEnchantSection && (
              <section className={enchantSectionMinHeight}>
                <div className="mb-4 flex items-center justify-between gap-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted">
                    Enchantment
                  </h3>
                  <label className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold text-zinc-300">
                    <input
                      type="checkbox"
                      checked={showAllEnchants}
                      onChange={(event) => setShowAllEnchants(event.target.checked)}
                      className="h-3.5 w-3.5 rounded border-border bg-surface-2"
                    />
                    <span>Show all enchants</span>
                  </label>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    onClick={() => setSelectedEnchant(0)}
                    className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                      selectedEnchant === 0
                        ? 'border-gold bg-gold/5 text-gold'
                        : 'border-white/5 bg-white/[0.02] text-gray-400 hover:border-white/20 hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded border border-white/5 bg-black/20">
                      <CircleX className="h-4 w-4" />
                    </div>
                    <div className="text-[13px] font-bold">No Enchant</div>
                  </button>
                  {filteredEnchants.map((e, idx) => (
                    <button
                      key={`ench-${e.enchantId}-${e.name}-${idx}`}
                      onClick={() => setSelectedEnchant(e.enchantId)}
                      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                        selectedEnchant === e.enchantId
                          ? 'border-gold bg-gold/5 text-gold'
                          : 'border-white/5 bg-white/[0.02] text-gray-400 hover:border-white/20 hover:bg-white/[0.04]'
                      }`}
                    >
                      <a
                        href={
                          e.itemId > 0
                            ? `https://www.wowhead.com/item=${e.itemId}`
                            : `https://www.wowhead.com/spell=${e.enchantId}`
                        }
                        data-wowhead={e.itemId > 0 ? `item=${e.itemId}` : `spell=${e.enchantId}`}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center"
                        onClick={(evt) => {
                          evt.preventDefault();
                          evt.stopPropagation();
                        }}
                      >
                        <img
                          src={`https://render.worldofwarcraft.com/icons/56/${e.icon}.jpg`}
                          alt=""
                          className="h-8 w-8 rounded border border-white/10"
                        />
                      </a>
                      <div className="line-clamp-1 text-[13px] font-bold leading-tight">
                        {e.name}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {showLoadingEmbellishmentSection && hasEmbellishmentSection && (
              <LoadingSection title="Embellishment" rows={4} />
            )}

            {/* Embellishment Selection (crafted-capable items only) */}
            {!loading && hasEmbellishmentSection && (
              <section>
                <div className="mb-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted">
                    Embellishment
                  </h3>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    onClick={() => setSelectedEmbellishment(0)}
                    className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                      selectedEmbellishment === 0
                        ? 'border-gold bg-gold/5 text-gold'
                        : 'border-white/5 bg-white/[0.02] text-gray-400 hover:border-white/20 hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded border border-white/5 bg-black/20">
                      <CircleX className="h-4 w-4" />
                    </div>
                    <div className="text-[13px] font-bold">No Embellishment</div>
                  </button>
                  {filteredEmbellishments.map((emb, idx) => (
                    <button
                      key={`emb-${emb.item_id}-${idx}`}
                      onClick={() => setSelectedEmbellishment(emb.item_id)}
                      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                        selectedEmbellishment === emb.item_id
                          ? 'border-gold bg-gold/5 text-gold'
                          : 'border-white/5 bg-white/[0.02] text-gray-400 hover:border-white/20 hover:bg-white/[0.04]'
                      }`}
                    >
                      <a
                        href={`https://www.wowhead.com/item=${emb.item_id}`}
                        data-wowhead={`item=${emb.item_id}`}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center"
                        onClick={(evt) => {
                          evt.preventDefault();
                          evt.stopPropagation();
                        }}
                      >
                        <img
                          src={`https://render.worldofwarcraft.com/icons/56/${emb.icon}.jpg`}
                          alt=""
                          className="h-8 w-8 rounded border border-white/10"
                        />
                      </a>
                      <div className="line-clamp-1 text-[13px] font-bold leading-tight">
                        {emb.name}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {showLoadingSocketSection && (
              <section className={socketSectionMinHeight}>
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted">
                    Socket Optimization
                  </h3>
                  <div className="h-7 w-28 rounded-md border border-border bg-surface-2/70" />
                </div>
                <div className="space-y-5">
                  {Array.from({ length: socketCount }, (_, socketIndex) => (
                    <div key={`socket-loading-${socketIndex}`} className="space-y-2.5">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                        {socketCount > 1 ? `Socket ${socketIndex + 1}` : 'Socket'}
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <LoadingOptionCard
                          label="Empty Socket"
                          sublabel="Gem"
                          icon={<CircleX className="h-4 w-4" />}
                        />
                        <LoadingSkeletonOptionCards rows={3} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Gem Selection */}
            {!loading && hasSocketSection && (
              <section className={socketSectionMinHeight}>
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted">
                    Socket Optimization
                  </h3>
                  <label className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold text-zinc-300">
                    <input
                      type="checkbox"
                      checked={showAllGems}
                      onChange={(event) => setShowAllGems(event.target.checked)}
                      className="h-3.5 w-3.5 rounded border-border bg-surface-2"
                    />
                    <span>Show all gems</span>
                  </label>
                </div>
                <div className="space-y-5">
                  {Array.from({ length: socketCount }, (_, socketIndex) => {
                    const selectedGemId = selectedGemIds[socketIndex] || 0;
                    return (
                      <div key={`socket-${socketIndex}`} className="space-y-2.5">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                          {socketCount > 1 ? `Socket ${socketIndex + 1}` : 'Socket'}
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <button
                            onClick={() => setSocketGem(socketIndex, 0)}
                            className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                              selectedGemId === 0
                                ? 'border-gold bg-gold/5 text-gold'
                                : 'border-white/5 bg-white/[0.02] text-gray-400 hover:border-white/20 hover:bg-white/[0.04]'
                            }`}
                          >
                            <div className="flex h-8 w-8 items-center justify-center rounded border border-white/5 bg-black/20 text-muted">
                              <CircleX className="h-4 w-4" />
                            </div>
                            <div className="text-[13px] font-bold">Empty Socket</div>
                          </button>
                          {filteredGems.map((g, idx) => (
                            <button
                              key={`socket-${socketIndex}-gem-${g.gemItemId}-${g.name}-${idx}`}
                              onClick={() => setSocketGem(socketIndex, g.gemItemId)}
                              className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                                selectedGemId === g.gemItemId
                                  ? 'border-gold bg-gold/5 text-gold'
                                  : 'border-white/5 bg-white/[0.02] text-gray-400 hover:border-white/20 hover:bg-white/[0.04]'
                              }`}
                            >
                              <a
                                href={`https://www.wowhead.com/item=${g.gemItemId}`}
                                data-wowhead={`item=${g.gemItemId}`}
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center"
                                onClick={(evt) => {
                                  evt.preventDefault();
                                  evt.stopPropagation();
                                }}
                              >
                                <img
                                  src={`https://render.worldofwarcraft.com/icons/56/${g.icon}.jpg`}
                                  alt=""
                                  className="h-8 w-8 rounded border border-white/10"
                                />
                              </a>
                              <div>
                                <div className="line-clamp-1 text-[13px] font-bold leading-tight">
                                  {g.name}
                                </div>
                                <div className="mt-0.5 text-[10px] text-muted">Gem</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/5 bg-white/[0.02] px-6 py-4">
          <p className="text-[11px] text-muted">
            {loading ? 'Loading options...' : 'Changes will create a copy of the item.'}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted transition-colors hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={loading}
              className="rounded-lg bg-gold px-6 py-2 text-xs font-bold uppercase tracking-widest text-black shadow-lg shadow-gold/20 transition-all hover:scale-[1.02] hover:bg-yellow-400 active:scale-[0.98] disabled:opacity-50"
            >
              Apply Optimization
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
