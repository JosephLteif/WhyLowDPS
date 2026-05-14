'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import ErrorAlert from '../components/ErrorAlert';
import { useSimContext } from '../components/SimContext';
import TopGearItemSelector from '../components/TopGearItemSelector';
import SimReturnNotice from '../components/shared/SimReturnNotice';
import ToggleOptionCard from '../components/shared/ToggleOptionCard';
import ConsumableSelect, { buildQualityMaxByFamily } from '../components/shared/ConsumableSelect';
import { API_URL } from '../lib/api';
import { getAppDefaultOption, getCharacterDefaultsKeyFromSimcInput } from '../lib/default-options';
import { useConsumableOptions } from '../lib/useConsumableOptions';
import { useSimSubmit } from '../lib/useSimSubmit';
import { consumeSimAgainState, consumeSimReturnNotice, type SimReturnNotice as SimReturnNoticeType } from '../lib/sim-return';
import type { ResolveGearResponse, ResolvedItem } from '../lib/types';

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

function toggleToken(list: string[], token: string): string[] {
  const t = token.trim();
  if (!t) return list;
  return list.includes(t) ? list.filter((v) => v !== t) : [...list, t];
}

function arraysEqual(a: string[], b: string[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function MultiPick({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: { key: string; token?: string; label: string }[];
  selected: string[];
  onToggle: (token: string) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
      <p className="text-[13px] font-semibold uppercase tracking-wider text-zinc-300">{title}</p>
      <div className="max-h-40 space-y-1 overflow-auto pr-1">
        {options.map((opt) => {
          const token = opt.token || '';
          const active = token !== '' && selected.includes(token);
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => token && onToggle(token)}
              className={`w-full rounded px-2 py-1.5 text-left text-xs ${
                active ? 'bg-gold/20 text-gold' : 'bg-surface-2 text-zinc-300 hover:bg-white/5'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface TopGearSimAgainState {
  simcInput?: string;
  selectedUids?: Record<string, string[]>;
  localItems?: LocalGearItem[];
  maxUpgrade?: boolean;
  copyEnchants?: boolean;
  catalyst?: boolean;
  catalystCharges?: number | null;
  compareConsumables?: boolean;
  matrixFlasks?: string[];
  matrixFoods?: string[];
  matrixPotions?: string[];
  matrixAugments?: string[];
  matrixTempEnchants?: string[];
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
  const [returnNotice, setReturnNotice] = useState<SimReturnNoticeType | null>(null);
  const [compareConsumables, setCompareConsumables] = useState(false);
  const [matrixFlasks, setMatrixFlasks] = useState<string[]>([]);
  const [matrixFoods, setMatrixFoods] = useState<string[]>([]);
  const [matrixPotions, setMatrixPotions] = useState<string[]>([]);
  const [matrixAugments, setMatrixAugments] = useState<string[]>([]);
  const [matrixTempEnchants, setMatrixTempEnchants] = useState<string[]>([]);
  const prevInputRef = useRef('');
  const prevUpgradeRef = useRef(false);
  const prevCatalystRef = useRef(false);
  const prevForceResolveSignalRef = useRef(0);
  const skipNextInputResetRef = useRef(false);
  const skipNextResolveRef = useRef(false);
  const previousSimcInputRef = useRef(simcInput);
  const localItemsRef = useRef<LocalGearItem[]>(localItems);
  const comboRequestSeqRef = useRef(0);
  const resolveRequestSeqRef = useRef(0);
  const [forceResolveSignal, setForceResolveSignal] = useState(0);
  const { flasks, foods, potions, augments, tempEnchants } = useConsumableOptions(11);
  const qualityMaxByFamily = useMemo(
    () => buildQualityMaxByFamily([flasks, potions, augments, tempEnchants]),
    [flasks, potions, augments, tempEnchants]
  );
  const hasConsumableMatrix = compareConsumables
    && (matrixFlasks.length > 0
      || matrixFoods.length > 0
      || matrixPotions.length > 0
      || matrixAugments.length > 0
      || matrixTempEnchants.length > 0);
  const isMultiConsumablesEnabledNow = () => {
    try {
      return localStorage.getItem('whylowdps_multi_consumables_enabled') === 'true';
    } catch {
      return false;
    }
  };
  const readStoredMatrixTokens = (key: string): string[] => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
    } catch {
      return [];
    }
  };
  const filterMatrixTokens = (
    tokens: string[],
    options: { token?: string; key: string }[]
  ): string[] => {
    if (!options.length) return [];
    const allowed = new Set(options.map((opt) => opt.token || opt.key).filter(Boolean));
    return tokens.filter((token) => allowed.has(token));
  };

  const hydrateConsumableMatrixFromStorage = useCallback(() => {
    try {
      const enabled = localStorage.getItem('whylowdps_multi_consumables_enabled') === 'true';
      setCompareConsumables((prev) => (prev === enabled ? prev : enabled));
      const read = (key: string): string[] => {
        try {
          const raw = localStorage.getItem(key);
          if (!raw) return [];
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
        } catch {
          return [];
        }
      };
      const nextFlasks = read('whylowdps_matrix_flasks');
      const nextFoods = read('whylowdps_matrix_foods');
      const nextPotions = read('whylowdps_matrix_potions');
      const nextAugments = read('whylowdps_matrix_augments');
      const nextTempEnchants = read('whylowdps_matrix_temp_enchants');
      setMatrixFlasks((prev) => (arraysEqual(prev, nextFlasks) ? prev : nextFlasks));
      setMatrixFoods((prev) => (arraysEqual(prev, nextFoods) ? prev : nextFoods));
      setMatrixPotions((prev) => (arraysEqual(prev, nextPotions) ? prev : nextPotions));
      setMatrixAugments((prev) => (arraysEqual(prev, nextAugments) ? prev : nextAugments));
      setMatrixTempEnchants((prev) =>
        arraysEqual(prev, nextTempEnchants) ? prev : nextTempEnchants
      );
    } catch {}
  }, []);

  useEffect(() => {
    localItemsRef.current = localItems;
  }, [localItems]);

  useEffect(() => {
    hydrateConsumableMatrixFromStorage();
    const onMatrixChanged = () => hydrateConsumableMatrixFromStorage();
    window.addEventListener('whylowdps-consumables-matrix-changed', onMatrixChanged);
    return () => window.removeEventListener('whylowdps-consumables-matrix-changed', onMatrixChanged);
  }, [hydrateConsumableMatrixFromStorage]);

  useEffect(() => {
    const restored = consumeSimAgainState<TopGearSimAgainState>(TOP_GEAR_SIM_AGAIN_KEY);
    const notice = consumeSimReturnNotice(TOP_GEAR_SIM_AGAIN_KEY);
    if (notice) setReturnNotice(notice);
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
    if (typeof restored.compareConsumables === 'boolean') setCompareConsumables(restored.compareConsumables);
    const restoredFlasks = Array.isArray(restored.matrixFlasks)
      ? restored.matrixFlasks.filter((x) => typeof x === 'string')
      : null;
    const restoredFoods = Array.isArray(restored.matrixFoods)
      ? restored.matrixFoods.filter((x) => typeof x === 'string')
      : null;
    const restoredPotions = Array.isArray(restored.matrixPotions)
      ? restored.matrixPotions.filter((x) => typeof x === 'string')
      : null;
    const restoredAugments = Array.isArray(restored.matrixAugments)
      ? restored.matrixAugments.filter((x) => typeof x === 'string')
      : null;
    const restoredTempEnchants = Array.isArray(restored.matrixTempEnchants)
      ? restored.matrixTempEnchants.filter((x) => typeof x === 'string')
      : null;

    if (restoredFlasks) setMatrixFlasks(restoredFlasks);
    if (restoredFoods) setMatrixFoods(restoredFoods);
    if (restoredPotions) setMatrixPotions(restoredPotions);
    if (restoredAugments) setMatrixAugments(restoredAugments);
    if (restoredTempEnchants) setMatrixTempEnchants(restoredTempEnchants);

    // Keep shared consumable UI in sync on Sim Again restore.
    try {
      if (typeof restored.compareConsumables === 'boolean') {
        localStorage.setItem(
          'whylowdps_multi_consumables_enabled',
          String(restored.compareConsumables)
        );
      }
      if (restoredFlasks) localStorage.setItem('whylowdps_matrix_flasks', JSON.stringify(restoredFlasks));
      if (restoredFoods) localStorage.setItem('whylowdps_matrix_foods', JSON.stringify(restoredFoods));
      if (restoredPotions) localStorage.setItem('whylowdps_matrix_potions', JSON.stringify(restoredPotions));
      if (restoredAugments) localStorage.setItem('whylowdps_matrix_augments', JSON.stringify(restoredAugments));
      if (restoredTempEnchants) localStorage.setItem(
        'whylowdps_matrix_temp_enchants',
        JSON.stringify(restoredTempEnchants)
      );
      window.dispatchEvent(new CustomEvent('whylowdps-consumables-matrix-changed'));
    } catch {}

    prevInputRef.current = restoredInput ?? simcInput.trim();
    prevUpgradeRef.current =
      typeof restored.maxUpgrade === 'boolean' ? restored.maxUpgrade : maxUpgrade;
    prevCatalystRef.current =
      typeof restored.catalyst === 'boolean' ? restored.catalyst : catalyst;

    skipNextInputResetRef.current = true;
    setForceResolveSignal((v) => v + 1);
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
    const forceResolve = forceResolveSignal !== prevForceResolveSignalRef.current;
    prevForceResolveSignalRef.current = forceResolveSignal;

    if (skipNextResolveRef.current) {
      skipNextResolveRef.current = false;
      return;
    }

    if (!forceResolve && !inputChanged && !upgradeChanged && !catalystChanged) return;

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
        const requestSeq = ++resolveRequestSeqRef.current;
        const controller = new AbortController();
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
            signal: controller.signal,
          });
          if (requestSeq !== resolveRequestSeqRef.current) return;
          if (!res.ok) {
            setResolved(null);
            setSelectedUids({});
            return;
          }
          const data: ResolveGearResponse = await res.json();
          if (requestSeq !== resolveRequestSeqRef.current) return;

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
          if (requestSeq !== resolveRequestSeqRef.current) return;
          setResolved(null);
          setSelectedUids({});
        } finally {
          if (requestSeq !== resolveRequestSeqRef.current) return;
          setResolving(false);
        }
      },
      inputChanged ? 300 : 0
    );
    return () => {
      clearTimeout(timer);
      // Invalidate any in-flight resolve for previous dependencies.
      resolveRequestSeqRef.current += 1;
    };
  }, [simcInput, maxUpgrade, catalyst, forceResolveSignal]);

  const buildSubmitInput = useCallback((): string => {
    return appendLocalItemsToSimcInput(simcInput, localItems);
  }, [simcInput, localItems]);

  const buildSelectedUidsJson = useCallback((): Record<string, string[]> => {
    if (!resolved) return {};
    const result: Record<string, string[]> = {};
    for (const [slot, uids] of Object.entries(selectedUids)) {
      const slotRes = resolved.slots[slot];
      const slotItems: ResolvedItem[] = slotRes
        ? [slotRes.equipped, ...slotRes.alternatives].filter(
            (item): item is ResolvedItem => Boolean(item)
          )
        : [];
      const included = new Set<string>();
      for (const uid of uids) {
        const item = slotItems.find((candidate) => candidate.uid === uid);
        if (!item) continue;
        included.add(item.uid);
      }
      if (included.size > 0) {
        result[slot] = [...included];
      }
    }
    return result;
  }, [resolved, selectedUids]);

  const buildItemsBySlotJson = useCallback((): Record<string, any[]> | null => {
    if (!resolved) return null;
    const result: Record<string, any[]> = {};
    for (const [slot, slotRes] of Object.entries(resolved.slots)) {
      const items = [];
      if (slotRes.equipped) items.push({ ...slotRes.equipped, is_equipped: true });
      if (slotRes.alternatives) {
        items.push(...slotRes.alternatives.map((alt) => ({ ...alt, is_equipped: false })));
      }
      if (items.length > 0) result[slot] = items;
    }
    return result;
  }, [resolved]);

  // Fetch combo count whenever selection changes
  useEffect(() => {
    const requestSeq = ++comboRequestSeqRef.current;
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
        const useMatrix = isMultiConsumablesEnabledNow();
        const storedFlasks = filterMatrixTokens(
          readStoredMatrixTokens('whylowdps_matrix_flasks'),
          flasks
        );
        const storedFoods = filterMatrixTokens(
          readStoredMatrixTokens('whylowdps_matrix_foods'),
          foods
        );
        const storedPotions = filterMatrixTokens(
          readStoredMatrixTokens('whylowdps_matrix_potions'),
          potions
        );
        const storedAugments = filterMatrixTokens(
          readStoredMatrixTokens('whylowdps_matrix_augments'),
          augments
        );
        const storedTempEnchants = filterMatrixTokens(
          readStoredMatrixTokens('whylowdps_matrix_temp_enchants'),
          tempEnchants
        );
        const hasStoredMatrix =
          storedFlasks.length > 0 ||
          storedFoods.length > 0 ||
          storedPotions.length > 0 ||
          storedAugments.length > 0 ||
          storedTempEnchants.length > 0;
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
            ...(useMatrix && hasStoredMatrix
              ? {
                  consumable_matrix_flasks: storedFlasks,
                  consumable_matrix_foods: storedFoods,
                  consumable_matrix_potions: storedPotions,
                  consumable_matrix_augmentations: storedAugments,
                  consumable_matrix_temporary_enchants: storedTempEnchants,
                }
              : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          if (requestSeq !== comboRequestSeqRef.current) return;
          setComboCount(0);
          setComboError('Failed to calculate combinations. Try selecting fewer items.');
          return;
        }
        const data = await res.json();
        if (requestSeq !== comboRequestSeqRef.current) return;
        setComboCount(data.combo_count ?? 0);
        setComboError(data.error ?? '');
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== 'AbortError') {
          if (requestSeq !== comboRequestSeqRef.current) return;
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
    hasConsumableMatrix,
    matrixFlasks,
    matrixFoods,
    matrixPotions,
    matrixAugments,
    matrixTempEnchants,
    flasks,
    foods,
    potions,
    augments,
    tempEnchants,
    buildSelectedUidsJson,
    buildSubmitInput,
    buildItemsBySlotJson,
  ]);

  const buildPayload = useCallback(
    () => {
      const useMatrix = isMultiConsumablesEnabledNow();
      const storedFlasks = filterMatrixTokens(
        readStoredMatrixTokens('whylowdps_matrix_flasks'),
        flasks
      );
      const storedFoods = filterMatrixTokens(
        readStoredMatrixTokens('whylowdps_matrix_foods'),
        foods
      );
      const storedPotions = filterMatrixTokens(
        readStoredMatrixTokens('whylowdps_matrix_potions'),
        potions
      );
      const storedAugments = filterMatrixTokens(
        readStoredMatrixTokens('whylowdps_matrix_augments'),
        augments
      );
      const storedTempEnchants = filterMatrixTokens(
        readStoredMatrixTokens('whylowdps_matrix_temp_enchants'),
        tempEnchants
      );
      const hasStoredMatrix =
        storedFlasks.length > 0 ||
        storedFoods.length > 0 ||
        storedPotions.length > 0 ||
        storedAugments.length > 0 ||
        storedTempEnchants.length > 0;
      return {
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
        ...(useMatrix && hasStoredMatrix
          ? {
              consumable_matrix_flasks: storedFlasks,
              consumable_matrix_foods: storedFoods,
              consumable_matrix_potions: storedPotions,
              consumable_matrix_augmentations: storedAugments,
              consumable_matrix_temporary_enchants: storedTempEnchants,
            }
          : {}),
      };
    },
    [
      buildSubmitInput,
      buildSelectedUidsJson,
      maxUpgrade,
      copyEnchants,
      maxCombinations,
      talentBuilds,
      catalyst,
      catalystCharges,
      hasConsumableMatrix,
      matrixFlasks,
      matrixFoods,
      matrixPotions,
      matrixAugments,
      matrixTempEnchants,
      flasks,
      foods,
      potions,
      augments,
      tempEnchants,
      buildItemsBySlotJson,
    ]
  );

  const isEmbellishmentComboError =
    /embellished|limited-effect crafted modifiers/i.test(comboError);
  const pageLevelError = isEmbellishmentComboError ? '' : comboError;

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
        simcInput,
        selectedUids: Object.fromEntries(
          Object.entries(selectedUids).map(([slot, values]) => [slot, [...values]])
        ),
        localItems,
        maxUpgrade,
        copyEnchants,
        catalyst,
        catalystCharges,
        compareConsumables: isMultiConsumablesEnabledNow(),
        matrixFlasks: readStoredMatrixTokens('whylowdps_matrix_flasks'),
        matrixFoods: readStoredMatrixTokens('whylowdps_matrix_foods'),
        matrixPotions: readStoredMatrixTokens('whylowdps_matrix_potions'),
        matrixAugments: readStoredMatrixTokens('whylowdps_matrix_augments'),
        matrixTempEnchants: readStoredMatrixTokens('whylowdps_matrix_temp_enchants'),
      }),
    },
  });

  const handleSubmit = useCallback(() => {
    void submit();
  }, [submit]);
  const hasSimcInput = simcInput.trim().length >= 10;
  const submitDisabled = submitting || !!pageLevelError || !resolved;

  return (
    <div className="space-y-6 pb-28">
      {returnNotice ? (
        <SimReturnNotice
          title={returnNotice.title}
          message={returnNotice.message}
          onDismiss={() => setReturnNotice(null)}
        />
      ) : null}
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

      {resolved ? (
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
        />
      ) : (
        <p className="py-6 text-center text-sm text-muted">
          {resolving
            ? 'Resolving gear...'
            : 'Paste your SimC addon export above to see gear options.'}
        </p>
      )}

      <ErrorAlert message={pageLevelError || error} />

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 ml-[var(--sidebar-width)] px-3 pb-4 pt-6 transition-[margin-left] duration-200 md:px-4 xl:px-10 2xl:px-16">
        <div
          className="mx-auto w-full min-w-0"
          style={{
            maxWidth: 'min(2200px, calc(100vw - var(--sidebar-width) - 1.5rem))',
          }}
        >
          <div className="pointer-events-auto bg-gradient-to-t from-[#111] via-[#111] to-transparent pt-6">
            <button
              onClick={handleSubmit}
              disabled={submitDisabled}
              className="btn-primary flex w-full items-center justify-center gap-2 py-3 text-sm"
            >
              {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              Starting sim…
            </>
              ) : resolving ? (
                'Resolving gear...'
              ) : hasSimcInput ? (
                buttonLabel('Find Top Gear')
              ) : (
                'Find Top Gear'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
