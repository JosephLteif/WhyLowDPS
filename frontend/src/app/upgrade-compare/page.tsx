/* eslint-disable @next/next/no-img-element */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ErrorAlert from '../components/ErrorAlert';
import ComboSummary from '../components/ComboSummary';
import GearItemRow from '../components/GearItemRow';
import StickyPageHeader from '../components/StickyPageHeader';
import { useSimContext } from '../components/SimContext';
import { API_URL } from '../lib/api';
import { SLOT_LABELS } from '../lib/types';
import { QUALITY_COLORS, getIconUrl, useItemInfo, type ItemQuery } from '../lib/useItemInfo';
import { useSimSubmit } from '../lib/useSimSubmit';
import { consumeSimAgainState } from '../lib/sim-return';

const UPGRADE_COMPARE_SIM_AGAIN_KEY = 'upgrade-compare';

interface UpgradeCompareSimAgainState {
  selectedSlots?: string[];
  upgradeMode?: 'highest_affordable' | 'all_affordable' | 'highest_any' | 'all_any';
  budgetOverride?: Record<string, string>;
}

// ---- Types ----

interface PrepareCandidate {
  slot: string;
  item_id: number;
  bonus_ids: number[];
  ilevel: number;
  target_ilevel: number;
  costs: Record<string, number>;
}

interface CurrencyMeta {
  id: number;
  amount: number;
  name: string;
  icon: string;
}

interface PrepareResponse {
  candidates: PrepareCandidate[];
  currencies: Record<string, CurrencyMeta>;
}

// ---- Helpers ----

function formatCosts(
  costs: Record<string, number>,
  currencies: Record<string, CurrencyMeta>
): string {
  const entries = Object.entries(costs).sort((a, b) => Number(a[0]) - Number(b[0]));
  if (entries.length === 0) return 'no cost';
  return entries
    .map(([cid, amount]) => {
      const name = currencies[cid]?.name;
      return name ? `${name} x${amount}` : `${cid}x${amount}`;
    })
    .join(', ');
}

function parseEquippedBySlot(simcInput: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const rawLine of simcInput.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=') || !line.includes('id=')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const slot = line.slice(0, eq).trim().toLowerCase();
    if (!slot) continue;
    const idMatch = line.match(/\bid=(\d+)\b/i);
    if (!idMatch) continue;
    const id = Number(idMatch[1]);
    if (Number.isFinite(id) && id > 0) out[slot] = id;
  }
  return out;
}

// ---- Data Hook (single endpoint) ----

function useUpgradeData(simcInput: string) {
  const [data, setData] = useState<PrepareResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (simcInput.trim().length < 10) {
      setData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/upgrade-compare/prepare`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ simc_input: simcInput }),
        });
        if (!res.ok || cancelled) return;
        const result: PrepareResponse = await res.json();
        if (!cancelled) setData(result);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [simcInput]);

  return { data, loading };
}

// ---- Page ----

export default function UpgradeComparePage() {
  const { simcInput, maxCombinations } = useSimContext();

  const { data, loading } = useUpgradeData(simcInput);
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [comboCount, setComboCount] = useState(0);
  const [upgradeMode, setUpgradeMode] = useState<
    'highest_affordable' | 'all_affordable' | 'highest_any' | 'all_any'
  >('highest_affordable');
  const [budgetOverride, setBudgetOverride] = useState<Record<string, string>>({});
  const skipNextDataResetRef = useRef(false);

  useEffect(() => {
    const restored = consumeSimAgainState<UpgradeCompareSimAgainState>(
      UPGRADE_COMPARE_SIM_AGAIN_KEY
    );
    if (!restored) return;
    if (Array.isArray(restored.selectedSlots)) {
      setSelectedSlots(
        new Set(restored.selectedSlots.filter((slot) => typeof slot === 'string' && slot.length > 0))
      );
    }
    if (
      restored.upgradeMode === 'highest_affordable' ||
      restored.upgradeMode === 'all_affordable' ||
      restored.upgradeMode === 'highest_any' ||
      restored.upgradeMode === 'all_any'
    ) {
      setUpgradeMode(restored.upgradeMode);
    }
    if (restored.budgetOverride && typeof restored.budgetOverride === 'object') {
      const next: Record<string, string> = {};
      for (const [cid, value] of Object.entries(restored.budgetOverride)) {
        if (typeof value === 'string') next[cid] = value;
      }
      setBudgetOverride(next);
    }
    skipNextDataResetRef.current = true;
  }, []);

  const candidates = useMemo(() => data?.candidates ?? [], [data]);
  const equippedBySlot = useMemo(() => parseEquippedBySlot(simcInput), [simcInput]);
  const currencies = useMemo(() => data?.currencies ?? {}, [data]);
  const hasCurrencies = Object.keys(currencies).length > 0;
  const effectiveCurrencies = useMemo(() => {
    const out = { ...currencies };
    for (const [cid, raw] of Object.entries(budgetOverride)) {
      const parsed = parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 0 || !out[cid]) continue;
      out[cid] = { ...out[cid], amount: parsed };
    }
    return out;
  }, [currencies, budgetOverride]);
  const budgetOverridePayload = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [cid, raw] of Object.entries(budgetOverride)) {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= 0) out[cid] = parsed;
    }
    return out;
  }, [budgetOverride]);

  // Reset selection when candidates change
  useEffect(() => {
    if (skipNextDataResetRef.current) {
      if (!data) return;
      skipNextDataResetRef.current = false;
      return;
    }
    setSelectedSlots(new Set());
    setComboCount(0);
    setBudgetOverride({});
  }, [data]);

  // Item info for display
  const infoQueries = useMemo<ItemQuery[]>(
    () => candidates.map((c) => ({ item_id: c.item_id, bonus_ids: c.bonus_ids })),
    [candidates]
  );
  const itemInfo = useItemInfo(infoQueries);

  // Debounced combo count
  const comboTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (selectedSlots.size === 0 || !simcInput.trim()) {
      setComboCount(0);
      return;
    }

    if (comboTimer.current) clearTimeout(comboTimer.current);
    comboTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/api/upgrade-compare/combo-count`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            simc_input: simcInput,
            selected_slots: [...selectedSlots],
            upgrade_depth:
              upgradeMode === 'all_affordable' || upgradeMode === 'all_any'
                ? 'all_levels'
                : 'highest_only',
            budget_mode:
              upgradeMode === 'highest_any' || upgradeMode === 'all_any'
                ? 'ignore_budget'
                : 'max_affordability',
            upgrade_budget_override: budgetOverridePayload,
            max_combinations: maxCombinations,
          }),
        });
        const result = await res.json();
        setComboCount(result.combo_count ?? 0);
      } catch {
        setComboCount(0);
      }
    }, 300);

    return () => clearTimeout(comboTimer.current);
  }, [simcInput, selectedSlots, maxCombinations, upgradeMode, budgetOverridePayload]);

  // Sim submission
  const buildPayload = useCallback(() => {
    if (selectedSlots.size === 0) return null;
    return {
      simc_input: simcInput,
      selected_slots: [...selectedSlots],
      upgrade_depth:
        upgradeMode === 'all_affordable' || upgradeMode === 'all_any'
          ? 'all_levels'
          : 'highest_only',
      budget_mode:
        upgradeMode === 'highest_any' || upgradeMode === 'all_any'
          ? 'ignore_budget'
          : 'max_affordability',
      upgrade_budget_override: budgetOverridePayload,
      max_combinations: maxCombinations,
    };
  }, [simcInput, selectedSlots, maxCombinations, upgradeMode, budgetOverridePayload]);

  const validate = useCallback(() => {
    if (selectedSlots.size === 0) return 'Select at least one upgradeable item.';
    return null;
  }, [selectedSlots]);

  const {
    submit: handleSubmit,
    submitting,
    error,
    buttonLabel,
  } = useSimSubmit({
    endpoint: '/api/upgrade-compare/sim',
    buildPayload,
    validate,
    simAgain: {
      pageKey: UPGRADE_COMPARE_SIM_AGAIN_KEY,
      captureState: () => ({
        selectedSlots: [...selectedSlots],
        upgradeMode,
        budgetOverride,
      }),
    },
  });

  // Group candidates by primary upgrade currency
  const candidateGroups = useMemo(() => {
    // Find which currencies are actually upgrade currencies (have cost data on candidates)
    const upgradeCurrencyIds = new Set<number>();
    for (const c of candidates) {
      for (const cid of Object.keys(c.costs).map(Number)) {
        if (currencies[String(cid)]) upgradeCurrencyIds.add(cid);
      }
    }

    const groups = new Map<number, PrepareCandidate[]>();
    for (const c of candidates) {
      const cid = Object.keys(c.costs)
        .map(Number)
        .find((id) => upgradeCurrencyIds.has(id));
      if (!cid) continue;
      const list = groups.get(cid) || [];
      list.push(c);
      groups.set(cid, list);
    }
    return [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([cid, items]) => ({
        currencyId: cid,
        currency: currencies[String(cid)],
        candidates: items,
      }));
  }, [candidates, currencies]);

  const hasCharacter = simcInput.trim().length >= 10;
  const displayComboCount = selectedSlots.size > 0 ? comboCount + 1 : 0;
  const modeLabel =
    upgradeMode === 'highest_affordable'
      ? 'Highest Affordable'
      : upgradeMode === 'all_affordable'
        ? 'All Affordable'
        : upgradeMode === 'highest_any'
          ? 'Highest Regardless'
          : 'All Regardless';

  const toggleGroup = (groupCandidates: PrepareCandidate[]) => {
    const slots = groupCandidates.map((c) => c.slot);
    const allSelected = slots.every((s) => selectedSlots.has(s));
    const next = new Set(selectedSlots);
    for (const s of slots) {
      if (allSelected) next.delete(s);
      else next.add(s);
    }
    setSelectedSlots(next);
  };

  const toggleAll = () => {
    const allSlots = candidates.map((c) => c.slot);
    const anyMissing = allSlots.some((s) => !selectedSlots.has(s));
    if (anyMissing) {
      setSelectedSlots(new Set(allSlots));
    } else {
      setSelectedSlots(new Set());
    }
  };

  const toggleAllEquipped = () => {
    const equippedSlots = candidates
      .filter((c) => equippedBySlot[c.slot] === c.item_id)
      .map((c) => c.slot);
    const allSelected = equippedSlots.length > 0 && equippedSlots.every((s) => selectedSlots.has(s));
    const next = new Set(selectedSlots);
    for (const s of equippedSlots) {
      if (allSelected) next.delete(s);
      else next.add(s);
    }
    setSelectedSlots(next);
  };

  if (!hasCharacter) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        Paste your SimC addon export above to begin.
      </p>
    );
  }

  const submitLabel = !hasCurrencies
    ? 'No upgrade currencies found'
    : selectedSlots.size === 0
      ? 'Select items to upgrade'
      : buttonLabel(`Sim Upgrades (${displayComboCount} combos, ${modeLabel})`);

  return (
    <div className="space-y-6">
      {/* Explainer */}
      <div className="rounded-lg border border-border/50 bg-surface-2/50 px-4 py-3">
        <p className="text-[15px] leading-relaxed text-zinc-400">
          Find the best way to spend your{' '}
          <span className="font-medium text-gold/80">Dawncrest upgrade currencies</span>. Select
          which equipped items to consider, and WhyLowDps will test every valid upgrade combination
          within your budget to find which gives the most DPS.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-[12px] font-medium uppercase tracking-widest text-muted">Upgrade Mode</p>
        <div className="grid gap-2 md:grid-cols-2">
          {[
            ['highest_affordable', 'Highest Affordable', 'Only the highest tier you can afford.'],
            ['all_affordable', 'All Affordable', 'Every upgrade tier you can afford.'],
            ['highest_any', 'Highest Regardless', 'Only the highest tier, even if unaffordable.'],
            ['all_any', 'All Regardless', 'Every tier, even if unaffordable.'],
          ].map(([key, label, desc]) => (
            <button
              key={key}
              type="button"
              onClick={() => setUpgradeMode(key as typeof upgradeMode)}
              className={`rounded-md border px-3 py-2 text-left transition-colors ${
                upgradeMode === key
                  ? 'border-gold/40 bg-gold/[0.08] text-zinc-100'
                  : 'border-border bg-surface-2 text-zinc-300 hover:border-zinc-600'
              }`}
            >
              <div className="text-xs font-semibold">{label}</div>
              <div className="mt-0.5 text-[10px] text-zinc-400">{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {hasCurrencies && (
        <div className="card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-widest text-muted">
              Override Budget
            </p>
            <p className="text-[11px] text-zinc-500">
              Leave blank to use the parsed export amounts.
            </p>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {Object.values(currencies)
              .filter((c) => c.name)
              .sort((a, b) => a.id - b.id)
              .map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-300">
                    {c.name}
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={budgetOverride[String(c.id)] ?? ''}
                    onChange={(e) =>
                      setBudgetOverride((prev) => ({ ...prev, [String(c.id)]: e.target.value }))
                    }
                    placeholder={String(c.amount)}
                    className="w-24 rounded border border-border bg-surface px-2 py-1 text-right font-mono text-xs tabular-nums text-white [appearance:textfield] focus:border-gold/50 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                </label>
              ))}
          </div>
        </div>
      )}

      {/* Currency Budget */}
      {hasCurrencies && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-medium uppercase tracking-widest text-muted">
            Budget
          </span>
          {Object.values(currencies)
            .filter((c) => c.name)
            .sort((a, b) => a.id - b.id)
            .map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1"
              >
                <img
                  src={getIconUrl(c.icon || 'inv_misc_questionmark')}
                  alt=""
                  className="h-4 w-4 shrink-0 rounded-sm"
                />
                <span className="text-[13px] text-gray-400">{c.name}</span>
                <span className="font-mono text-[13px] tabular-nums text-white">
                  {effectiveCurrencies[String(c.id)]?.amount ?? c.amount}
                </span>
              </div>
            ))}
        </div>
      )}

      {/* Upgradeable Items */}
      <div className="space-y-4">
        <StickyPageHeader
          left={
            <div className="flex flex-wrap items-center gap-4">
              <p className="text-xs font-medium uppercase tracking-widest text-muted">
                Select Items to Upgrade
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-[11px] font-bold text-gold/80 transition-colors hover:text-gold"
                >
                  All
                </button>
                <span className="h-3 w-px bg-zinc-700" />
                <button
                  type="button"
                  onClick={toggleAllEquipped}
                  className="text-[11px] font-bold text-zinc-300 transition-colors hover:text-white"
                >
                  Equipped
                </button>
                <span className="h-3 w-px bg-zinc-700" />
                <button
                  type="button"
                  onClick={() => setSelectedSlots(new Set())}
                  className="text-[11px] font-bold text-zinc-500 transition-colors hover:text-zinc-300"
                >
                  Clear
                </button>
              </div>
              {hasCurrencies && (
                <div className="hidden flex-wrap items-center gap-1.5 xl:flex">
                  {Object.values(currencies)
                    .filter((c) => c.name)
                    .sort((a, b) => a.id - b.id)
                    .map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1"
                      >
                        <img
                          src={getIconUrl(c.icon || 'inv_misc_questionmark')}
                          alt=""
                          className="h-3.5 w-3.5 shrink-0 rounded-sm"
                        />
                        <span className="max-w-24 truncate text-[11px] text-zinc-300">{c.name}</span>
                        <span className="font-mono text-[11px] tabular-nums text-zinc-100">
                          {effectiveCurrencies[String(c.id)]?.amount ?? c.amount}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          }
          right={
            <ComboSummary
              comboCount={displayComboCount}
              maxCombinations={maxCombinations ?? undefined}
              breakdown={
                comboCount !== 0
                  ? `${comboCount.toLocaleString()} normal combos | +1 Currently Equipped`
                  : null
              }
            />
          }
        />

        {loading ? (
          <div className="card flex justify-center p-8">
            <svg className="h-6 w-6 animate-spin text-gold" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
              <path
                d="M14 8a6 6 0 00-6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
        ) : candidates.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-sm text-muted">No upgradeable equipped items found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {candidateGroups.map((group) => {
              const groupSlots = group.candidates.map((c) => c.slot);
              const allSelected =
                groupSlots.length > 0 && groupSlots.every((s) => selectedSlots.has(s));

              return (
                <div key={group.currencyId} className="card space-y-1 p-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <img
                        src={getIconUrl(group.currency?.icon || 'inv_misc_questionmark')}
                        alt=""
                        className="h-4 w-4 shrink-0 rounded-sm"
                      />
                      <p className="text-[13px] font-semibold uppercase tracking-widest text-muted">
                        {group.currency?.name || `Currency ${group.currencyId}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.candidates)}
                      className="text-[12px] text-zinc-500 hover:text-zinc-300"
                    >
                      {allSelected ? 'Deselect' : 'Select all'}
                    </button>
                  </div>

                  {group.candidates.map((c) => {
                    const info = itemInfo[c.item_id];
                    const qc = info ? QUALITY_COLORS[info.quality] || '#fff' : '#fff';
                    const isEquipped = equippedBySlot[c.slot] === c.item_id;

                    return (
                      <GearItemRow
                        key={c.slot}
                        icon={info?.icon || 'inv_misc_questionmark'}
                        name={info?.name || `Item ${c.item_id}`}
                        nameColor={qc}
                        details={[
                          { text: SLOT_LABELS[c.slot] || c.slot },
                          {
                            text: isEquipped ? 'Equipped' : 'Not Equipped',
                            color: isEquipped ? 'text-emerald-300' : 'text-zinc-500',
                          },
                          { text: `${c.ilevel} -> ${c.target_ilevel}` },
                          {
                            text: formatCosts(c.costs, effectiveCurrencies),
                            color: 'text-gold/70',
                          },
                        ]}
                        ilevel={c.ilevel}
                        selectable
                        checked={selectedSlots.has(c.slot)}
                        onToggle={() => {
                          const next = new Set(selectedSlots);
                          if (selectedSlots.has(c.slot)) next.delete(c.slot);
                          else next.add(c.slot);
                          setSelectedSlots(next);
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ErrorAlert message={error} />

      <div className="sticky bottom-0 z-50 -mx-4 bg-gradient-to-t from-[#111] via-[#111] to-transparent px-4 pb-4 pt-6">
        <button
          onClick={handleSubmit}
          disabled={submitting || selectedSlots.size === 0 || !hasCurrencies}
          className="btn-primary flex w-full items-center justify-center gap-2 py-3 text-sm"
        >
          {submitting ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                <path
                  d="M14 8a6 6 0 00-6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              Starting sim...
            </>
          ) : (
            submitLabel
          )}
        </button>
      </div>
    </div>
  );
}
