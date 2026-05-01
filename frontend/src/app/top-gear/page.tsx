'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ErrorAlert from '../components/ErrorAlert';
import { useSimContext } from '../components/SimContext';
import TopGearItemSelector from '../components/TopGearItemSelector';
import ToggleOptionCard from '../components/shared/ToggleOptionCard';
import { API_URL } from '../lib/api';
import { getAppDefaultOption, getCharacterDefaultsKeyFromSimcInput } from '../lib/default-options';
import { useSimSubmit } from '../lib/useSimSubmit';
import { consumeSimAgainState } from '../lib/sim-return';
import type { ResolveGearResponse } from '../lib/types';

const TOP_GEAR_SIM_AGAIN_KEY = 'top-gear';

interface LocalGearItem {
  slot: string;
  simc_string: string;
  origin: string;
}

function appendLocalItemsToSimcInput(baseInput: string, localItems: LocalGearItem[]): string {
  let result = baseInput;
  if (localItems.length === 0) return result;

  const vaultItems = localItems.filter((li) => li.origin === 'vault');
  const bagItems = localItems.filter((li) => li.origin !== 'vault');

  if (vaultItems.length > 0) {
    const vaultLines = vaultItems.map((li) => `# ${li.slot}=${li.simc_string}`).join('\n');
    const endMarker = '### End of Weekly Reward Choices';
    if (result.includes(endMarker)) {
      result = result.replace(endMarker, vaultLines + '\n' + endMarker);
    } else {
      result = result + '\n' + vaultLines;
    }
  }
  if (bagItems.length > 0) {
    const bagLines = bagItems.map((li) => `# ${li.slot}=${li.simc_string}`).join('\n');
    result = result + '\n' + bagLines;
  }
  return result;
}

interface TopGearSimAgainState {
  simcInput?: string;
  selectedUids?: Record<string, string[]>;
  localItems?: LocalGearItem[];
  maxUpgrade?: boolean;
  copyEnchants?: boolean;
  catalyst?: boolean;
  catalystCharges?: number | null;
  resolved?: ResolveGearResponse | null;
}

export default function TopGearPage() {
  const { simcInput, setSimcInput, maxCombinations, scenarios, talentBuilds } = useSimContext();
  const characterDefaultsKey = getCharacterDefaultsKeyFromSimcInput(simcInput);
  const [resolved, setResolved] = useState<ResolveGearResponse | null>(null);
  const [selectedUids, setSelectedUids] = useState<Record<string, Set<string>>>({});
  const [localItems, setLocalItems] = useState<LocalGearItem[]>([]);
  const [maxUpgrade, setMaxUpgrade] = useState(() =>
    getAppDefaultOption('topgear.maxUpgrade', { characterKey: characterDefaultsKey })
  );
  const [copyEnchants, setCopyEnchants] = useState(() =>
    getAppDefaultOption('topgear.copyEnchants', { characterKey: characterDefaultsKey })
  );
  const [catalyst, setCatalyst] = useState(() =>
    getAppDefaultOption('topgear.catalyst', { characterKey: characterDefaultsKey })
  );
  const [catalystCharges, setCatalystCharges] = useState<number | null>(null);
  const [resolving, setResolving] = useState(false);
  const [comboCount, setComboCount] = useState(0);
  const [comboError, setComboError] = useState('');
  const [excludedSelectedUids, setExcludedSelectedUids] = useState<Set<string>>(new Set());
  const prevInputRef = useRef('');
  const prevUpgradeRef = useRef(false);
  const prevCatalystRef = useRef(false);
  const skipNextInputResetRef = useRef(false);
  const skipNextResolveRef = useRef(false);
  const previousSimcInputRef = useRef(simcInput);
  const localItemsRef = useRef<LocalGearItem[]>(localItems);

  useEffect(() => {
    localItemsRef.current = localItems;
  }, [localItems]);

  useEffect(() => {
    const restored = consumeSimAgainState<TopGearSimAgainState>(TOP_GEAR_SIM_AGAIN_KEY);
    if (!restored) return;

    const restoredInput =
      typeof restored.simcInput === 'string' && restored.simcInput.trim().length > 0
        ? restored.simcInput.trim()
        : null;
    if (restoredInput) setSimcInput(restoredInput);

    if (restored.selectedUids && typeof restored.selectedUids === 'object') {
      const next: Record<string, Set<string>> = {};
      for (const [slot, values] of Object.entries(restored.selectedUids)) {
        next[slot] = new Set(Array.isArray(values) ? values.filter((v) => typeof v === 'string') : []);
      }
      setSelectedUids(next);
    }

    if (Array.isArray(restored.localItems)) {
      setLocalItems(
        restored.localItems.filter(
          (item) =>
            !!item &&
            typeof item.slot === 'string' &&
            typeof item.simc_string === 'string' &&
            typeof item.origin === 'string'
        )
      );
    }

    if (typeof restored.maxUpgrade === 'boolean') setMaxUpgrade(restored.maxUpgrade);
    if (typeof restored.copyEnchants === 'boolean') setCopyEnchants(restored.copyEnchants);
    if (typeof restored.catalyst === 'boolean') setCatalyst(restored.catalyst);
    if (restored.catalystCharges == null || Number.isFinite(restored.catalystCharges)) {
      setCatalystCharges(restored.catalystCharges ?? null);
    }
    if (restored.resolved && typeof restored.resolved === 'object') {
      setResolved(restored.resolved);
      skipNextResolveRef.current = true;
    }

    prevInputRef.current = restoredInput ?? simcInput.trim();
    prevUpgradeRef.current =
      typeof restored.maxUpgrade === 'boolean' ? restored.maxUpgrade : maxUpgrade;
    prevCatalystRef.current =
      typeof restored.catalyst === 'boolean' ? restored.catalyst : catalyst;

    skipNextInputResetRef.current = true;
  }, [simcInput, maxUpgrade, catalyst, setSimcInput]);

  useEffect(() => {
    if (simcInput === previousSimcInputRef.current) return;
    previousSimcInputRef.current = simcInput;
    setCopyEnchants(
      getAppDefaultOption('topgear.copyEnchants', { characterKey: characterDefaultsKey })
    );
    setMaxUpgrade(
      getAppDefaultOption('topgear.maxUpgrade', { characterKey: characterDefaultsKey })
    );
    setCatalyst(
      getAppDefaultOption('topgear.catalyst', { characterKey: characterDefaultsKey })
    );
  }, [simcInput, characterDefaultsKey]);

  // Resolve gear when simc input, maxUpgrade, or catalyst changes
  useEffect(() => {
    const trimmed = simcInput.trim();
    const inputChanged = trimmed !== prevInputRef.current;
    const upgradeChanged = maxUpgrade !== prevUpgradeRef.current;
    const catalystChanged = catalyst !== prevCatalystRef.current;

    if (skipNextResolveRef.current) {
      skipNextResolveRef.current = false;
      return;
    }

    if (!inputChanged && !upgradeChanged && !catalystChanged) return;

    if (trimmed.length < 10) {
      setResolved(null);
      setSelectedUids({});
      prevInputRef.current = trimmed;
      prevUpgradeRef.current = maxUpgrade;
      prevCatalystRef.current = catalyst;
      return;
    }

    const timer = setTimeout(
      async () => {
        prevInputRef.current = trimmed;
        prevUpgradeRef.current = maxUpgrade;
        prevCatalystRef.current = catalyst;
        setResolving(true);
        try {
          const res = await fetch(`${API_URL}/api/gear/resolve`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              simc_input: appendLocalItemsToSimcInput(simcInput, localItemsRef.current),
              max_upgrade: maxUpgrade,
              catalyst,
            }),
          });
          if (!res.ok) {
            setResolved(null);
            setSelectedUids({});
            return;
          }
          const data: ResolveGearResponse = await res.json();

          const hasAlternatives = Object.values(data.slots).some(
            (slot) => slot.alternatives.length > 0
          );
          if (!hasAlternatives) {
            setResolved(null);
            setSelectedUids({});
            setLocalItems([]);
            return;
          }

          setResolved(data);

          if (inputChanged && data.catalyst_charges != null) {
            setCatalystCharges(data.catalyst_charges);
          }

          if (inputChanged) {
            if (skipNextInputResetRef.current) {
              skipNextInputResetRef.current = false;
              return;
            }
            setSelectedUids({});
            setLocalItems([]);
          }
        } catch {
          setResolved(null);
          setSelectedUids({});
        } finally {
          setResolving(false);
        }
      },
      inputChanged ? 300 : 0
    );
    return () => clearTimeout(timer);
  }, [simcInput, maxUpgrade, catalyst]);

  const buildSubmitInput = useCallback((): string => {
    return appendLocalItemsToSimcInput(simcInput, localItems);
  }, [simcInput, localItems]);

  const buildSelectedUidsJson = useCallback((): Record<string, string[]> => {
    const result: Record<string, string[]> = {};
    for (const [slot, uids] of Object.entries(selectedUids)) {
      const included = [...uids].filter((uid) => !excludedSelectedUids.has(uid));
      if (included.length > 0) {
        result[slot] = included;
      }
    }
    return result;
  }, [selectedUids, excludedSelectedUids]);

  const buildItemsBySlotJson = useCallback((): Record<string, any[]> | null => {
    if (!resolved) return null;
    const result: Record<string, any[]> = {};
    for (const [slot, slotRes] of Object.entries(resolved.slots)) {
      const items = [];
      if (slotRes.equipped) items.push({ ...slotRes.equipped, is_equipped: true });
      if (slotRes.alternatives) {
        items.push(
          ...slotRes.alternatives
            .filter((alt) => !excludedSelectedUids.has(alt.uid))
            .map((alt) => ({ ...alt, is_equipped: false }))
        );
      }
      if (items.length > 0) result[slot] = items;
    }
    return result;
  }, [resolved, excludedSelectedUids]);

  // Fetch combo count whenever selection changes
  useEffect(() => {
    const selectedItemsForSubmit = buildSelectedUidsJson();
    const hasGearSelection = Object.values(selectedItemsForSubmit).some((uids) => uids.length > 0);
    const hasTalentCompare = talentBuilds.length > 1;
    if (!resolved || (!hasGearSelection && !hasTalentCompare)) {
      setComboCount(0);
      setComboError('');
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/top-gear/combo-count`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            simc_input: buildSubmitInput(),
            selected_items: selectedItemsForSubmit,
            items_by_slot: buildItemsBySlotJson(),
            max_upgrade: maxUpgrade,
            copy_enchants: copyEnchants,
            ...(maxCombinations != null ? { max_combinations: maxCombinations } : {}),
            ...(talentBuilds.length > 1
              ? {
                  talent_builds: talentBuilds.map((tb) => ({
                    name: tb.name,
                    talent_string: tb.talentString,
                  })),
                }
              : {}),
            catalyst,
            ...(catalystCharges != null ? { catalyst_charges: catalystCharges } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          setComboCount(0);
          setComboError('Failed to calculate combinations. Try selecting fewer items.');
          return;
        }
        const data = await res.json();
        setComboCount(data.combo_count ?? 0);
        setComboError(data.error ?? '');
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== 'AbortError') {
          setComboCount(0);
          setComboError('Failed to calculate combinations. Try selecting fewer items.');
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    selectedUids,
    resolved,
    localItems,
    maxUpgrade,
    copyEnchants,
    maxCombinations,
    talentBuilds,
    catalyst,
    catalystCharges,
    buildSelectedUidsJson,
    buildSubmitInput,
    buildItemsBySlotJson,
  ]);

  const buildPayload = useCallback(
    () => ({
      simc_input: buildSubmitInput(),
      selected_items: buildSelectedUidsJson(),
      items_by_slot: buildItemsBySlotJson(),
      max_upgrade: maxUpgrade,
      copy_enchants: copyEnchants,
      ...(maxCombinations != null ? { max_combinations: maxCombinations } : {}),
      ...(talentBuilds.length > 1
        ? {
            talent_builds: talentBuilds.map((tb) => ({
              name: tb.name,
              talent_string: tb.talentString,
            })),
          }
        : {}),
      catalyst,
      ...(catalystCharges != null ? { catalyst_charges: catalystCharges } : {}),
    }),
    [
      buildSubmitInput,
      buildSelectedUidsJson,
      maxUpgrade,
      copyEnchants,
      maxCombinations,
      talentBuilds,
      catalyst,
      catalystCharges,
      buildItemsBySlotJson,
    ]
  );

  const isEmbellishmentComboError =
    /embellished|limited-effect crafted modifiers/i.test(comboError);
  const isExcludedOverflowComboError =
    excludedSelectedUids.size > 0 && /no valid combinations/i.test(comboError);
  const pageLevelError = isEmbellishmentComboError || isExcludedOverflowComboError ? '' : comboError;

  const validate = useCallback(() => {
    if (!resolved) return 'No gear resolved';
    if (pageLevelError) return pageLevelError;
    return null;
  }, [resolved, pageLevelError]);

  const { submit, submitting, error, buttonLabel } = useSimSubmit({
    endpoint: '/api/top-gear/sim',
    buildPayload,
    validate,
    simAgain: {
      pageKey: TOP_GEAR_SIM_AGAIN_KEY,
      captureState: () => ({
        selectedUids: Object.fromEntries(
          Object.entries(selectedUids).map(([slot, values]) => [slot, [...values]])
        ),
        localItems,
        maxUpgrade,
        copyEnchants,
        catalyst,
        catalystCharges,
        resolved,
      }),
    },
  });

  const handleSubmit = useCallback(() => {
    void submit();
  }, [submit]);

  if (!resolved) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        {resolving
          ? 'Resolving gear...'
          : 'Paste your SimC addon export above to see gear options.'}
      </p>
    );
  } else {
    console.log(resolved);
  }

  return (
    <div className="space-y-6">
      <div className="card space-y-4 p-5">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              setCopyEnchants(
                getAppDefaultOption('topgear.copyEnchants', { characterKey: characterDefaultsKey })
              );
              setMaxUpgrade(
                getAppDefaultOption('topgear.maxUpgrade', { characterKey: characterDefaultsKey })
              );
              setCatalyst(
                getAppDefaultOption('topgear.catalyst', { characterKey: characterDefaultsKey })
              );
            }}
            className="rounded-md border border-gold/45 bg-gold/[0.12] px-2.5 py-1 text-[12px] font-semibold text-gold transition-colors hover:bg-gold/[0.2]"
          >
            Apply Defaults
          </button>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
        <ToggleOptionCard
          checked={copyEnchants}
          onToggle={() => setCopyEnchants(!copyEnchants)}
          title="Copy Enchants/Gems"
          description="Apply equipped enchants and gems to items that don't have one"
        />
        <ToggleOptionCard
          checked={maxUpgrade}
          onToggle={() => setMaxUpgrade(!maxUpgrade)}
          title="Sim Highest Upgrade"
          description="Treat all selected gear as their maximum upgrade level"
        />
        {catalystCharges != null && catalystCharges > 0 && (
          <div className="flex flex-1 items-center gap-3">
            <ToggleOptionCard
              checked={catalyst}
              onToggle={() => setCatalyst(!catalyst)}
              title="Revival Catalyst"
              description="Convert highest item per slot"
              activeClassName="bg-purple-500"
              activeKnobClassName="bg-white"
            />
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                max={10}
                value={catalystCharges}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 0) setCatalystCharges(v);
                }}
                className="input-field !w-12 !px-1.5 !py-0.5 text-center !text-[13px]"
              />
              <span className="text-[13px] text-gray-500">charges</span>
            </div>
          </div>
        )}
        </div>
      </div>

      <TopGearItemSelector
        resolved={resolved}
        selectedUids={selectedUids}
        onSelectionChange={setSelectedUids}
        onResolvedChange={setResolved}
        onItemAdded={(slot, simcString, origin) =>
          setLocalItems((prev) => [...prev, { slot, simc_string: simcString, origin }])
        }
        maxUpgrade={maxUpgrade}
        comboCount={comboCount}
        comboError={comboError}
        onExcludedUidsChange={setExcludedSelectedUids}
      />

      <ErrorAlert message={pageLevelError || error} />

      <div className="sticky bottom-0 z-50 -mx-4 bg-gradient-to-t from-[#111] via-[#111] to-transparent px-4 pb-4 pt-6">
        <button
          onClick={handleSubmit}
          disabled={submitting || !!pageLevelError}
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
              Starting sim…
            </>
          ) : (
            buttonLabel('Find Top Gear')
          )}
        </button>
      </div>
    </div>
  );
}
