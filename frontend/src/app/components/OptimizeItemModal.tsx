'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { CircleX, Search, X } from 'lucide-react';
import { API_URL } from '../lib/api';
import type { ResolvedItem } from '../lib/types';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import { useDismissOnOutside } from '../lib/useDismissOnOutside';

/** Raw enchant shape returned by the backend (straight from enchantments.json). */
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
}

/** Raw gem shape returned by the backend (straight from enchantments.json, slot=socket). */
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
}

/** Deduplicated enchant for display — highest crafting quality per base name. */
interface EnchantDisplay {
  enchantId: number;
  name: string;
  icon: string;
  quality: number;
  itemId: number;
}

/** Deduplicated gem for display — highest crafting quality per base gem. */
interface GemDisplay {
  gemItemId: number;
  enchantId: number;
  name: string;
  icon: string;
  quality: number;
  expansion: number;
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
  onApply: (
    enchantId: number,
    gemIds: number[],
    embellishment: EmbellishmentOption | null
  ) => void;
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

/**
 * Pick the best (highest crafting quality) enchant per base name.
 * This avoids showing "Cursed Haste 1", "Cursed Haste 2", "Cursed Haste 3" separately.
 */
function deduplicateEnchants(raw: RawEnchant[]): EnchantDisplay[] {
  const byBase = new Map<string, RawEnchant>();
  for (const e of raw) {
    // Skip socket-type entries (those are gems)
    if (e.slot === 'socket') continue;
    const baseName =
      e.baseDisplayName ||
      e.itemName ||
      e.displayName ||
      e.name ||
      `enchant-${e.enchant_id ?? e.id ?? 0}`;
    const existing = byBase.get(baseName);
    if (!existing || (e.craftingQuality ?? 0) > (existing.craftingQuality ?? 0)) {
      byBase.set(baseName, e);
    }
  }
  return Array.from(byBase.values())
    .map((e) => ({
      enchantId: e.enchant_id ?? e.id ?? 0,
      name: e.itemName || e.displayName || e.name || 'Unknown',
      icon: e.itemIcon || e.spellIcon || 'inv_misc_questionmark',
      quality: e.quality ?? 3,
      itemId: e.itemId ?? 0,
    }))
    .filter((e) => e.enchantId > 0);
}

/**
 * Pick the best (highest crafting quality) gem per base item name.
 */
function deduplicateGems(raw: RawGem[]): GemDisplay[] {
  const byBase = new Map<string, RawGem>();
  for (const g of raw) {
    const baseName =
      g.itemName || g.displayName || g.name || `gem-${g.item_id ?? g.itemId ?? g.id ?? 0}`;
    const existing = byBase.get(baseName);
    if (!existing || (g.craftingQuality ?? 0) > (existing.craftingQuality ?? 0)) {
      byBase.set(baseName, g);
    }
  }
  return Array.from(byBase.values())
    .map((g) => ({
      gemItemId: g.item_id ?? g.itemId ?? g.id ?? 0,
      enchantId: g.id ?? 0,
      name: g.itemName || g.displayName || g.name || 'Unknown',
      icon: g.itemIcon || g.icon || 'inv_misc_questionmark',
      quality: g.quality ?? 3,
      expansion: g.expansion ?? 0,
    }))
    .filter((g) => g.gemItemId > 0);
}

export default function OptimizeItemModal({
  isOpen,
  onClose,
  item,
  className,
  onApply,
}: OptimizeItemModalProps) {
  const [rawEnchants, setRawEnchants] = useState<RawEnchant[]>([]);
  const [rawGems, setRawGems] = useState<RawGem[]>([]);
  const [rawEmbellishments, setRawEmbellishments] = useState<EmbellishmentOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedEnchant, setSelectedEnchant] = useState<number>(0);
  const [selectedGemIds, setSelectedGemIds] = useState<number[]>([]);
  const [selectedEmbellishment, setSelectedEmbellishment] = useState<number>(0);
  const [searchTerm, setSearchTerm] = useState('');
  const modalRef = useRef<HTMLDivElement | null>(null);

  // Derive display lists from raw data
  const enchants = useMemo(() => deduplicateEnchants(rawEnchants), [rawEnchants]);
  const gems = useMemo(() => deduplicateGems(rawGems), [rawGems]);
  const embellishments = useMemo(() => rawEmbellishments, [rawEmbellishments]);
  useWowheadTooltips([isOpen, enchants.length, gems.length, embellishments.length, searchTerm]);

  useEffect(() => {
    if (isOpen && item) {
      fetchOptions();
      setSelectedEnchant(item.enchant_id || 0);
      const itemGemIds = parseGemIdsFromItem(item);
      const socketCount = Math.max(Number(item.sockets || 0), itemGemIds.length);
      setSelectedGemIds(
        Array.from({ length: socketCount }, (_, index) => itemGemIds[index] || 0)
      );
      setSelectedEmbellishment(item.embellishment_item_id || 0);
      setSearchTerm('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, item, className]);
  useDismissOnOutside(modalRef, isOpen, onClose);

  async function fetchOptions() {
    if (!item) return;
    setLoading(true);
    try {
      const enchantParams = new URLSearchParams();
      enchantParams.set('slot', item.slot);
      if (className) enchantParams.set('class_name', className);
      if (item.item_id > 0) enchantParams.set('item_id', String(item.item_id));
      if (Array.isArray(item.bonus_ids) && item.bonus_ids.length > 0) {
        enchantParams.set('bonus_ids', item.bonus_ids.join(','));
      }
      if (Number.isFinite(item.season_id) && Number(item.season_id) > 0) {
        enchantParams.set('season_id', String(Number(item.season_id)));
      }
      const [enchantsRes, gemsRes, embellishmentsRes] = await Promise.all([
        fetch(`${API_URL}/api/gear/enchant-options?${enchantParams.toString()}`, {
          credentials: 'include',
        }),
        fetch(`${API_URL}/api/gear/gem-options`, { credentials: 'include' }),
        fetch(
          `${API_URL}/api/gear/embellishment-options?item_id=${encodeURIComponent(String(item.item_id))}`,
          { credentials: 'include' }
        ),
      ]);
      if (enchantsRes.ok) {
        setRawEnchants(await enchantsRes.json());
      }
      if (gemsRes.ok) {
        setRawGems(await gemsRes.json());
      }
      if (embellishmentsRes.ok) {
        const options = (await embellishmentsRes.json()) as EmbellishmentOption[];
        setRawEmbellishments(options);
      } else {
        setRawEmbellishments([]);
      }
    } catch (e) {
      console.error('Failed to fetch optimization options', e);
      setRawEmbellishments([]);
    }
    setLoading(false);
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
        ? seasonalGems.filter((g) => g.name.toLowerCase().includes(normalizedSearch))
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
  const hasEnchantSection = enchants.length > 0;
  const hasSocketSection = socketCount > 0;
  const hasEmbellishmentSection = embellishments.length > 0;
  const showSearch = hasEnchantSection || hasSocketSection || hasEmbellishmentSection;

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

      <div ref={modalRef} className="relative w-full max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-surface shadow-2xl">
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
                Optimization
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

        <div className="max-h-[70vh] overflow-y-auto p-6">
          <div className="space-y-8">
            {showSearch && (
              <section>
                <div className="relative">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search enchants, gems, embellishments..."
                    className="h-9 w-full rounded-md bg-white/5 pl-9 pr-3 text-sm text-white placeholder-gray-500 ring-1 ring-white/10 focus:bg-white/10 focus:outline-none focus:ring-gold/50"
                  />
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
                </div>
              </section>
            )}

            {/* Enchant Selection */}
            {hasEnchantSection && (
              <section>
                <div className="mb-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted">
                    Enchantment
                  </h3>
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

            {/* Embellishment Selection (crafted-capable items only) */}
            {hasEmbellishmentSection && (
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

            {/* Gem Selection */}
            {hasSocketSection && (
              <section>
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted">
                    Socket Optimization
                  </h3>
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
