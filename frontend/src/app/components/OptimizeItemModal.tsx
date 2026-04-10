'use client';

import { useEffect, useState, useMemo } from 'react';
import { API_URL } from '../lib/api';
import type { ResolvedItem } from '../lib/types';

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
}

/** Deduplicated gem for display — highest crafting quality per base gem. */
interface GemDisplay {
  gemItemId: number; // itemId — what SimC uses as gem_id
  enchantId: number; // the enchant "id" (useful for lookup)
  name: string;
  icon: string;
  quality: number;
}

interface OptimizeItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: ResolvedItem | null;
  onApply: (enchantId: number, gemIds: number[]) => void;
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
  return Array.from(byBase.values()).map((e) => ({
    enchantId: e.enchant_id ?? e.id ?? 0,
    name: e.itemName || e.displayName || e.name || 'Unknown',
    icon: e.itemIcon || e.spellIcon || 'inv_misc_questionmark',
    quality: e.quality ?? 3,
  })).filter((e) => e.enchantId > 0);
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
  return Array.from(byBase.values()).map((g) => ({
    gemItemId: g.item_id ?? g.itemId ?? g.id ?? 0,
    enchantId: g.id ?? 0,
    name: g.itemName || g.displayName || g.name || 'Unknown',
    icon: g.itemIcon || g.icon || 'inv_misc_questionmark',
    quality: g.quality ?? 3,
  })).filter((g) => g.gemItemId > 0);
}

export default function OptimizeItemModal({
  isOpen,
  onClose,
  item,
  onApply,
}: OptimizeItemModalProps) {
  const [rawEnchants, setRawEnchants] = useState<RawEnchant[]>([]);
  const [rawGems, setRawGems] = useState<RawGem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedEnchant, setSelectedEnchant] = useState<number>(0);
  const [selectedGem, setSelectedGem] = useState<number>(0);
  const [searchTerm, setSearchTerm] = useState('');

  // Derive display lists from raw data
  const enchants = useMemo(() => deduplicateEnchants(rawEnchants), [rawEnchants]);
  const gems = useMemo(() => deduplicateGems(rawGems), [rawGems]);

  useEffect(() => {
    if (isOpen && item) {
      fetchOptions();
      setSelectedEnchant(item.enchant_id || 0);
      setSelectedGem(item.gem_id || 0);
      setSearchTerm('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, item]);

  async function fetchOptions() {
    if (!item) return;
    setLoading(true);
    try {
      const [enchantsRes, gemsRes] = await Promise.all([
        fetch(`${API_URL}/api/gear/enchant-options?slot=${item.slot}`, { credentials: 'include' }),
        fetch(`${API_URL}/api/gear/gem-options`, { credentials: 'include' }),
      ]);
      if (enchantsRes.ok) {
        setRawEnchants(await enchantsRes.json());
      }
      if (gemsRes.ok) {
        setRawGems(await gemsRes.json());
      }
    } catch (e) {
      console.error('Failed to fetch optimization options', e);
    }
    setLoading(false);
  }

  if (!isOpen || !item) return null;

  const filteredGems = gems.filter((g) => g.name.toLowerCase().includes(searchTerm.toLowerCase()));

  function handleApply() {
    onApply(selectedEnchant, selectedGem ? [selectedGem] : []);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-surface shadow-2xl">
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
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-6">
          <div className="space-y-8">
            {/* Enchant Selection */}
            {enchants.length > 0 && (
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
                      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                    <div className="text-[13px] font-bold">No Enchant</div>
                  </button>
                  {enchants.map((e, idx) => (
                    <button
                      key={`ench-${e.enchantId}-${e.name}-${idx}`}
                      onClick={() => setSelectedEnchant(e.enchantId)}
                      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                        selectedEnchant === e.enchantId
                          ? 'border-gold bg-gold/5 text-gold'
                          : 'border-white/5 bg-white/[0.02] text-gray-400 hover:border-white/20 hover:bg-white/[0.04]'
                      }`}
                    >
                      <img
                        src={`https://render.worldofwarcraft.com/icons/56/${e.icon}.jpg`}
                        alt=""
                        className="h-8 w-8 rounded border border-white/10"
                      />
                      <div className="line-clamp-1 text-[13px] font-bold leading-tight">
                        {e.name}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Gem Selection */}
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-widest text-muted">
                  Socket Optimization
                </h3>
                {item.sockets > 0 && (
                  <div className="relative">
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search gems..."
                      className="h-8 w-48 rounded-md bg-white/5 pl-8 pr-3 text-xs text-white placeholder-gray-500 ring-1 ring-white/10 focus:bg-white/10 focus:outline-none focus:ring-gold/50"
                    />
                    <svg
                      className="absolute left-2.5 top-2 h-4 w-4 text-gray-500"
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
                )}
              </div>

              {item.sockets === 0 && (
                <div className="rounded-lg border border-dashed border-white/5 bg-white/[0.01] px-4 py-8 text-center text-[13px] text-muted">
                  This item does not have any sockets.
                </div>
              )}

              {item.sockets > 0 && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    onClick={() => setSelectedGem(0)}
                    className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                      selectedGem === 0
                        ? 'border-gold bg-gold/5 text-gold'
                        : 'border-white/5 bg-white/[0.02] text-gray-400 hover:border-white/20 hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded border border-white/5 bg-black/20 text-muted">
                      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                    <div className="text-[13px] font-bold">Empty Sockets</div>
                  </button>
                  {filteredGems.map((g, idx) => (
                    <button
                      key={`gem-${g.gemItemId}-${g.name}-${idx}`}
                      onClick={() => setSelectedGem(g.gemItemId)}
                      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                        selectedGem === g.gemItemId
                          ? 'border-gold bg-gold/5 text-gold'
                          : 'border-white/5 bg-white/[0.02] text-gray-400 hover:border-white/20 hover:bg-white/[0.04]'
                      }`}
                    >
                      <img
                        src={`https://render.worldofwarcraft.com/icons/56/${g.icon}.jpg`}
                        alt=""
                        className="h-8 w-8 rounded border border-white/10"
                      />
                      <div>
                        <div className="line-clamp-1 text-[13px] font-bold leading-tight">
                          {g.name}
                        </div>
                        <div className="mt-0.5 text-[10px] text-muted">Gem</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
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
