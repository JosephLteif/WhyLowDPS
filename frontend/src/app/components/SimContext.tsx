'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { FightScenario } from '../lib/types';
import { API_URL, fetchJson } from '../lib/api';
import {
  getAppDefaultOption,
  getCharacterDefaultsKeyFromSimcInput,
  setLastActiveCharacterDefaultsKey,
} from '../lib/default-options';

interface SimContextType {
  simcInput: string;
  setSimcInput: (v: string) => void;
  fightStyle: string;
  setFightStyle: (v: string) => void;
  threads: number;
  setThreads: (v: number) => void;
  maxCombinations: number | undefined;
  setMaxCombinations: (v: number | undefined) => void;
  selectedTalent: string;
  setSelectedTalent: (v: string) => void;
  targetCount: number;
  setTargetCount: (v: number) => void;
  fightLength: number;
  setFightLength: (v: number) => void;
  customApl: string;
  setCustomApl: (v: string) => void;
  simcChannel: string;
  setSimcChannel: (v: string) => void;
  includeTimeline: boolean;
  setIncludeTimeline: (v: boolean) => void;
  externalBuffChaosBrand: boolean;
  setExternalBuffChaosBrand: (v: boolean) => void;
  externalBuffMysticTouch: boolean;
  setExternalBuffMysticTouch: (v: boolean) => void;
  externalBuffSkyfury: boolean;
  setExternalBuffSkyfury: (v: boolean) => void;
  externalBuffPowerInfusion: boolean;
  setExternalBuffPowerInfusion: (v: boolean) => void;
  externalBuffBlessingOfBronze: boolean;
  setExternalBuffBlessingOfBronze: (v: boolean) => void;
  externalBuffAugmentation: boolean;
  setExternalBuffAugmentation: (v: boolean) => void;
  raidBuffBloodlust: boolean;
  setRaidBuffBloodlust: (v: boolean) => void;
  raidBuffArcaneIntellect: boolean;
  setRaidBuffArcaneIntellect: (v: boolean) => void;
  raidBuffPowerWordFortitude: boolean;
  setRaidBuffPowerWordFortitude: (v: boolean) => void;
  raidBuffMarkOfTheWild: boolean;
  setRaidBuffMarkOfTheWild: (v: boolean) => void;
  raidBuffBattleShout: boolean;
  setRaidBuffBattleShout: (v: boolean) => void;
  raidBuffHuntersMark: boolean;
  setRaidBuffHuntersMark: (v: boolean) => void;
  raidBuffBleeding: boolean;
  setRaidBuffBleeding: (v: boolean) => void;
  consumableFlask: string;
  setConsumableFlask: (v: string) => void;
  consumableFood: string;
  setConsumableFood: (v: string) => void;
  consumablePotion: string;
  setConsumablePotion: (v: string) => void;
  consumableAugmentation: string;
  setConsumableAugmentation: (v: string) => void;
  consumableTemporaryEnchant: string;
  setConsumableTemporaryEnchant: (v: string) => void;
  lockSingleConsumableOptions: boolean;
  setLockSingleConsumableOptions: (v: boolean) => void;
  autoClipboardPasteSimc: boolean;
  setAutoClipboardPasteSimc: (v: boolean) => void;
  dataCacheRefreshMinutes: number;
  setDataCacheRefreshMinutes: (v: number) => void;
  // Expert Mode injection points
  simcHeader: string;
  setSimcHeader: (v: string) => void;
  simcBasePlayer: string;
  setSimcBasePlayer: (v: string) => void;
  simcRaidActors: string;
  setSimcRaidActors: (v: string) => void;
  simcPostCombos: string;
  setSimcPostCombos: (v: string) => void;
  simcFooter: string;
  setSimcFooter: (v: string) => void;
  // Multi-talent compare
  talentBuilds: { name: string; talentString: string }[];
  setTalentBuilds: (v: { name: string; talentString: string }[]) => void;
  // Multi-sim scenarios
  scenarios: FightScenario[];
  addScenario: () => void;
  removeScenario: (id: string) => void;
  clearScenarios: () => void;
}

const SimContext = createContext<SimContextType | null>(null);

export function useSimContext() {
  const ctx = useContext(SimContext);
  if (!ctx) throw new Error('useSimContext must be used within SimProvider');
  return ctx;
}

function readStored(key: string, fallback: number): number {
  const v = localStorage.getItem(key);
  if (v == null) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readStoredBool(key: string, fallback: boolean): boolean {
  const v = localStorage.getItem(key);
  if (v == null) return fallback;
  return v === 'true';
}

function readStoredOptionalNumber(key: string): number | undefined {
  const v = localStorage.getItem(key);
  if (v == null) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function readStoredString(key: string, fallback = ''): string {
  const v = localStorage.getItem(key);
  if (v == null) return fallback;
  return v;
}

function readSessionString(key: string, fallback: string): string {
  return sessionStorage.getItem(key) ?? fallback;
}

export function SimProvider({ children }: { children: ReactNode }) {
  const [simcInput, _setSimcInput] = useState('');
  const [fightStyle, _setFightStyle] = useState('Patchwerk');
  const [threads, _setThreads] = useState(0);
  const [maxCombinations, _setMaxCombinations] = useState<number | undefined>(undefined);
  const [selectedTalent, setSelectedTalent] = useState('');
  const [targetCount, _setTargetCount] = useState(1);
  const [fightLength, _setFightLength] = useState(300);
  const [customApl, setCustomApl] = useState('');
  const [simcChannel, _setSimcChannel] = useState('bundled');
  const [includeTimeline, _setIncludeTimeline] = useState(true);
  const [externalBuffChaosBrand, _setExternalBuffChaosBrand] = useState(true);
  const [externalBuffMysticTouch, _setExternalBuffMysticTouch] = useState(true);
  const [externalBuffSkyfury, _setExternalBuffSkyfury] = useState(true);
  const [externalBuffPowerInfusion, _setExternalBuffPowerInfusion] = useState(false);
  const [externalBuffBlessingOfBronze, _setExternalBuffBlessingOfBronze] = useState(false);
  const [externalBuffAugmentation, _setExternalBuffAugmentation] = useState(false);
  const [raidBuffBloodlust, _setRaidBuffBloodlust] = useState(true);
  const [raidBuffArcaneIntellect, _setRaidBuffArcaneIntellect] = useState(true);
  const [raidBuffPowerWordFortitude, _setRaidBuffPowerWordFortitude] = useState(true);
  const [raidBuffMarkOfTheWild, _setRaidBuffMarkOfTheWild] = useState(true);
  const [raidBuffBattleShout, _setRaidBuffBattleShout] = useState(true);
  const [raidBuffHuntersMark, _setRaidBuffHuntersMark] = useState(true);
  const [raidBuffBleeding, _setRaidBuffBleeding] = useState(true);
  const [consumableFlask, _setConsumableFlask] = useState('');
  const [consumableFood, _setConsumableFood] = useState('');
  const [consumablePotion, _setConsumablePotion] = useState('');
  const [consumableAugmentation, _setConsumableAugmentation] = useState('');
  const [consumableTemporaryEnchant, _setConsumableTemporaryEnchant] = useState('');
  const [lockSingleConsumableOptions, setLockSingleConsumableOptions] = useState(false);
  const [autoClipboardPasteSimc, _setAutoClipboardPasteSimc] = useState(true);
  const [dataCacheRefreshMinutes, _setDataCacheRefreshMinutes] = useState(0);

  const [simcHeader, setSimcHeader] = useState('');
  const [simcBasePlayer, setSimcBasePlayer] = useState('');
  const [simcRaidActors, setSimcRaidActors] = useState('');
  const [simcPostCombos, setSimcPostCombos] = useState('');
  const [simcFooter, setSimcFooter] = useState('');
  const [talentBuilds, setTalentBuilds] = useState<{ name: string; talentString: string }[]>([]);
  const [scenarios, setScenarios] = useState<FightScenario[]>([]);
  const lastAppliedDefaultsCharacterKeyRef = useRef<string | null>(null);

  const applyDefaultsForCharacter = useCallback((characterKey: string | null) => {
    const fightStyleDefault = getAppDefaultOption('fight.fightStyle', { characterKey });
    const fightLengthDefault = getAppDefaultOption('fight.fightLength', { characterKey });
    const targetCountDefault = getAppDefaultOption('fight.targetCount', { characterKey });
    const raidBloodlustDefault = getAppDefaultOption('raid.bloodlust', { characterKey });
    const raidArcaneIntellectDefault = getAppDefaultOption('raid.arcaneIntellect', { characterKey });
    const raidFortitudeDefault = getAppDefaultOption('raid.powerWordFortitude', { characterKey });
    const raidMarkOfTheWildDefault = getAppDefaultOption('raid.markOfTheWild', { characterKey });
    const raidBattleShoutDefault = getAppDefaultOption('raid.battleShout', { characterKey });
    const raidHuntersMarkDefault = getAppDefaultOption('raid.huntersMark', { characterKey });
    const raidBleedingDefault = getAppDefaultOption('raid.bleeding', { characterKey });
    const externalChaosBrandDefault = getAppDefaultOption('raid.chaosBrand', { characterKey });
    const externalMysticTouchDefault = getAppDefaultOption('raid.mysticTouch', { characterKey });
    const externalSkyfuryDefault = getAppDefaultOption('raid.skyfury', { characterKey });
    const externalPowerInfusionDefault = getAppDefaultOption('raid.powerInfusion', { characterKey });
    const consumableFlaskDefault = getAppDefaultOption('consumable.flask', { characterKey });
    const consumableFoodDefault = getAppDefaultOption('consumable.food', { characterKey });
    const consumablePotionDefault = getAppDefaultOption('consumable.potion', { characterKey });
    const consumableAugmentationDefault = getAppDefaultOption('consumable.augmentation', { characterKey });
    const consumableTemporaryEnchantDefault = getAppDefaultOption('consumable.temporaryEnchant', { characterKey });

    _setFightStyle(fightStyleDefault);
    _setFightLength(fightLengthDefault);
    _setTargetCount(targetCountDefault);
    _setRaidBuffBloodlust(raidBloodlustDefault);
    _setRaidBuffArcaneIntellect(raidArcaneIntellectDefault);
    _setRaidBuffPowerWordFortitude(raidFortitudeDefault);
    _setRaidBuffMarkOfTheWild(raidMarkOfTheWildDefault);
    _setRaidBuffBattleShout(raidBattleShoutDefault);
    _setRaidBuffHuntersMark(raidHuntersMarkDefault);
    _setRaidBuffBleeding(raidBleedingDefault);
    _setExternalBuffChaosBrand(externalChaosBrandDefault);
    _setExternalBuffMysticTouch(externalMysticTouchDefault);
    _setExternalBuffSkyfury(externalSkyfuryDefault);
    _setExternalBuffPowerInfusion(externalPowerInfusionDefault);
    _setConsumableFlask(consumableFlaskDefault);
    _setConsumableFood(consumableFoodDefault);
    _setConsumablePotion(consumablePotionDefault);
    _setConsumableAugmentation(consumableAugmentationDefault);
    _setConsumableTemporaryEnchant(consumableTemporaryEnchantDefault);

    try {
      localStorage.setItem('whylowdps_fight_style', fightStyleDefault);
      localStorage.setItem('whylowdps_fight_length', String(fightLengthDefault));
      localStorage.setItem('whylowdps_target_count', String(targetCountDefault));
      localStorage.setItem('whylowdps_raid_buff_bloodlust', String(raidBloodlustDefault));
      localStorage.setItem('whylowdps_raid_buff_arcane_intellect', String(raidArcaneIntellectDefault));
      localStorage.setItem('whylowdps_raid_buff_power_word_fortitude', String(raidFortitudeDefault));
      localStorage.setItem('whylowdps_raid_buff_mark_of_the_wild', String(raidMarkOfTheWildDefault));
      localStorage.setItem('whylowdps_raid_buff_battle_shout', String(raidBattleShoutDefault));
      localStorage.setItem('whylowdps_raid_buff_hunters_mark', String(raidHuntersMarkDefault));
      localStorage.setItem('whylowdps_raid_buff_bleeding', String(raidBleedingDefault));
      localStorage.setItem('whylowdps_ext_buff_chaos_brand', String(externalChaosBrandDefault));
      localStorage.setItem('whylowdps_ext_buff_mystic_touch', String(externalMysticTouchDefault));
      localStorage.setItem('whylowdps_ext_buff_skyfury', String(externalSkyfuryDefault));
      localStorage.setItem('whylowdps_ext_buff_power_infusion', String(externalPowerInfusionDefault));
      localStorage.setItem('whylowdps_consumable_flask', consumableFlaskDefault);
      localStorage.setItem('whylowdps_consumable_food', consumableFoodDefault);
      localStorage.setItem('whylowdps_consumable_potion', consumablePotionDefault);
      localStorage.setItem('whylowdps_consumable_augmentation', consumableAugmentationDefault);
      localStorage.setItem('whylowdps_consumable_temporary_enchant', consumableTemporaryEnchantDefault);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const storedSimcInput = readSessionString('whylowdps_simc_input', '');
      const characterKey = getCharacterDefaultsKeyFromSimcInput(storedSimcInput);
      if (characterKey) setLastActiveCharacterDefaultsKey(characterKey);
      lastAppliedDefaultsCharacterKeyRef.current = characterKey;
      _setSimcInput(storedSimcInput);
      _setFightStyle(
        readStoredString(
          'whylowdps_fight_style',
          getAppDefaultOption('fight.fightStyle', { characterKey })
        )
      );
      _setThreads(readStored('whylowdps_threads', 0));
      _setMaxCombinations(readStoredOptionalNumber('whylowdps_max_combinations'));
      _setTargetCount(
        readStored(
          'whylowdps_target_count',
          getAppDefaultOption('fight.targetCount', { characterKey })
        )
      );
      _setFightLength(
        readStored(
          'whylowdps_fight_length',
          getAppDefaultOption('fight.fightLength', { characterKey })
        )
      );
      _setIncludeTimeline(readStoredBool('whylowdps_include_timeline', true));
      _setExternalBuffChaosBrand(
        readStoredBool(
          'whylowdps_ext_buff_chaos_brand',
          getAppDefaultOption('raid.chaosBrand', { characterKey })
        )
      );
      _setExternalBuffMysticTouch(
        readStoredBool(
          'whylowdps_ext_buff_mystic_touch',
          getAppDefaultOption('raid.mysticTouch', { characterKey })
        )
      );
      _setExternalBuffSkyfury(
        readStoredBool(
          'whylowdps_ext_buff_skyfury',
          getAppDefaultOption('raid.skyfury', { characterKey })
        )
      );
      _setExternalBuffPowerInfusion(
        readStoredBool(
          'whylowdps_ext_buff_power_infusion',
          getAppDefaultOption('raid.powerInfusion', { characterKey })
        )
      );
      _setExternalBuffBlessingOfBronze(
        readStoredBool('whylowdps_ext_buff_blessing_of_bronze', false)
      );
      _setExternalBuffAugmentation(readStoredBool('whylowdps_ext_buff_augmentation', false));
      _setRaidBuffBloodlust(
        readStoredBool(
          'whylowdps_raid_buff_bloodlust',
          getAppDefaultOption('raid.bloodlust', { characterKey })
        )
      );
      _setRaidBuffArcaneIntellect(
        readStoredBool(
          'whylowdps_raid_buff_arcane_intellect',
          getAppDefaultOption('raid.arcaneIntellect', { characterKey })
        )
      );
      _setRaidBuffPowerWordFortitude(
        readStoredBool(
          'whylowdps_raid_buff_power_word_fortitude',
          getAppDefaultOption('raid.powerWordFortitude', { characterKey })
        )
      );
      _setRaidBuffMarkOfTheWild(
        readStoredBool(
          'whylowdps_raid_buff_mark_of_the_wild',
          getAppDefaultOption('raid.markOfTheWild', { characterKey })
        )
      );
      _setRaidBuffBattleShout(
        readStoredBool(
          'whylowdps_raid_buff_battle_shout',
          getAppDefaultOption('raid.battleShout', { characterKey })
        )
      );
      _setRaidBuffHuntersMark(
        readStoredBool(
          'whylowdps_raid_buff_hunters_mark',
          getAppDefaultOption('raid.huntersMark', { characterKey })
        )
      );
      _setRaidBuffBleeding(
        readStoredBool(
          'whylowdps_raid_buff_bleeding',
          getAppDefaultOption('raid.bleeding', { characterKey })
        )
      );
      _setConsumableFlask(
        readStoredString(
          'whylowdps_consumable_flask',
          getAppDefaultOption('consumable.flask', { characterKey })
        )
      );
      _setConsumableFood(
        readStoredString(
          'whylowdps_consumable_food',
          getAppDefaultOption('consumable.food', { characterKey })
        )
      );
      _setConsumablePotion(
        readStoredString(
          'whylowdps_consumable_potion',
          getAppDefaultOption('consumable.potion', { characterKey })
        )
      );
      _setConsumableAugmentation(
        readStoredString(
          'whylowdps_consumable_augmentation',
          getAppDefaultOption('consumable.augmentation', { characterKey })
        )
      );
      _setConsumableTemporaryEnchant(
        readStoredString(
          'whylowdps_consumable_temporary_enchant',
          getAppDefaultOption('consumable.temporaryEnchant', { characterKey })
        )
      );
      _setSimcChannel(readStoredString('whylowdps_simc_channel', 'bundled') || 'bundled');
      _setAutoClipboardPasteSimc(readStoredBool('whylowdps_auto_clipboard_paste_simc', true));
      _setDataCacheRefreshMinutes(readStored('whylowdps_data_cache_refresh_minutes', 0));
      const rawChannel = readStoredString('whylowdps_simc_channel', 'bundled') || 'bundled';
      const normalizedChannel =
        rawChannel === 'weekly' || rawChannel === 'latest' ? 'bundled' : rawChannel;
      _setSimcChannel(normalizedChannel);
    } catch {}
  }, []);

  const addScenario = useCallback(() => {
    setScenarios((prev) => [
      ...prev,
      { id: crypto.randomUUID(), fightStyle, targetCount, fightLength },
    ]);
  }, [fightStyle, targetCount, fightLength]);

  const removeScenario = useCallback((id: string) => {
    setScenarios((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const clearScenarios = useCallback(() => {
    setScenarios([]);
  }, []);

  const setSimcInput = useCallback((v: string) => {
    _setSimcInput(v);
    try {
      sessionStorage.setItem('whylowdps_simc_input', v);
      const characterKey = getCharacterDefaultsKeyFromSimcInput(v);
      if (characterKey) {
        setLastActiveCharacterDefaultsKey(characterKey);
        const prevKey = lastAppliedDefaultsCharacterKeyRef.current;
        if (prevKey !== characterKey) {
          applyDefaultsForCharacter(characterKey);
          lastAppliedDefaultsCharacterKeyRef.current = characterKey;
        }
      } else {
        lastAppliedDefaultsCharacterKeyRef.current = null;
      }
    } catch {}
  }, [applyDefaultsForCharacter]);

  const setThreads = useCallback((v: number) => {
    _setThreads(v);
    try {
      localStorage.setItem('whylowdps_threads', String(v));
    } catch {}
  }, []);

  const setMaxCombinations = useCallback((v: number | undefined) => {
    _setMaxCombinations(v);
    try {
      if (v == null) {
        localStorage.removeItem('whylowdps_max_combinations');
      } else {
        localStorage.setItem('whylowdps_max_combinations', String(v));
      }
    } catch {}
  }, []);

  const setFightStyle = useCallback((v: string) => {
    _setFightStyle(v);
    try {
      localStorage.setItem('whylowdps_fight_style', v);
    } catch {}
  }, []);

  const setTargetCount = useCallback((v: number) => {
    _setTargetCount(v);
    try {
      localStorage.setItem('whylowdps_target_count', String(v));
    } catch {}
  }, []);

  const setFightLength = useCallback((v: number) => {
    _setFightLength(v);
    try {
      localStorage.setItem('whylowdps_fight_length', String(v));
    } catch {}
  }, []);

  const setIncludeTimeline = useCallback((v: boolean) => {
    _setIncludeTimeline(v);
    try {
      localStorage.setItem('whylowdps_include_timeline', String(v));
    } catch {}
  }, []);

  const setExternalBuffChaosBrand = useCallback((v: boolean) => {
    _setExternalBuffChaosBrand(v);
    try {
      localStorage.setItem('whylowdps_ext_buff_chaos_brand', String(v));
    } catch {}
  }, []);

  const setExternalBuffMysticTouch = useCallback((v: boolean) => {
    _setExternalBuffMysticTouch(v);
    try {
      localStorage.setItem('whylowdps_ext_buff_mystic_touch', String(v));
    } catch {}
  }, []);

  const setExternalBuffSkyfury = useCallback((v: boolean) => {
    _setExternalBuffSkyfury(v);
    try {
      localStorage.setItem('whylowdps_ext_buff_skyfury', String(v));
    } catch {}
  }, []);

  const setExternalBuffPowerInfusion = useCallback((v: boolean) => {
    _setExternalBuffPowerInfusion(v);
    try {
      localStorage.setItem('whylowdps_ext_buff_power_infusion', String(v));
    } catch {}
  }, []);

  const setExternalBuffBlessingOfBronze = useCallback((v: boolean) => {
    _setExternalBuffBlessingOfBronze(v);
    try {
      localStorage.setItem('whylowdps_ext_buff_blessing_of_bronze', String(v));
    } catch {}
  }, []);

  const setExternalBuffAugmentation = useCallback((v: boolean) => {
    _setExternalBuffAugmentation(v);
    try {
      localStorage.setItem('whylowdps_ext_buff_augmentation', String(v));
    } catch {}
  }, []);

  const setRaidBuffBloodlust = useCallback((v: boolean) => {
    _setRaidBuffBloodlust(v);
    try {
      localStorage.setItem('whylowdps_raid_buff_bloodlust', String(v));
    } catch {}
  }, []);

  const setRaidBuffArcaneIntellect = useCallback((v: boolean) => {
    _setRaidBuffArcaneIntellect(v);
    try {
      localStorage.setItem('whylowdps_raid_buff_arcane_intellect', String(v));
    } catch {}
  }, []);

  const setRaidBuffPowerWordFortitude = useCallback((v: boolean) => {
    _setRaidBuffPowerWordFortitude(v);
    try {
      localStorage.setItem('whylowdps_raid_buff_power_word_fortitude', String(v));
    } catch {}
  }, []);

  const setRaidBuffMarkOfTheWild = useCallback((v: boolean) => {
    _setRaidBuffMarkOfTheWild(v);
    try {
      localStorage.setItem('whylowdps_raid_buff_mark_of_the_wild', String(v));
    } catch {}
  }, []);

  const setRaidBuffBattleShout = useCallback((v: boolean) => {
    _setRaidBuffBattleShout(v);
    try {
      localStorage.setItem('whylowdps_raid_buff_battle_shout', String(v));
    } catch {}
  }, []);

  const setRaidBuffHuntersMark = useCallback((v: boolean) => {
    _setRaidBuffHuntersMark(v);
    try {
      localStorage.setItem('whylowdps_raid_buff_hunters_mark', String(v));
    } catch {}
  }, []);

  const setRaidBuffBleeding = useCallback((v: boolean) => {
    _setRaidBuffBleeding(v);
    try {
      localStorage.setItem('whylowdps_raid_buff_bleeding', String(v));
    } catch {}
  }, []);

  const setConsumableFlask = useCallback((v: string) => {
    _setConsumableFlask(v);
    try {
      localStorage.setItem('whylowdps_consumable_flask', v);
    } catch {}
  }, []);

  const setConsumableFood = useCallback((v: string) => {
    _setConsumableFood(v);
    try {
      localStorage.setItem('whylowdps_consumable_food', v);
    } catch {}
  }, []);

  const setConsumablePotion = useCallback((v: string) => {
    _setConsumablePotion(v);
    try {
      localStorage.setItem('whylowdps_consumable_potion', v);
    } catch {}
  }, []);

  const setConsumableAugmentation = useCallback((v: string) => {
    _setConsumableAugmentation(v);
    try {
      localStorage.setItem('whylowdps_consumable_augmentation', v);
    } catch {}
  }, []);

  const setConsumableTemporaryEnchant = useCallback((v: string) => {
    _setConsumableTemporaryEnchant(v);
    try {
      localStorage.setItem('whylowdps_consumable_temporary_enchant', v);
    } catch {}
  }, []);

  const setSimcChannel = useCallback((v: string) => {
    let normalized = (v || 'bundled').toLowerCase();
    // Normalize legacy channel names
    if (normalized === 'weekly' || normalized === 'latest') {
      normalized = 'bundled';
    }
    _setSimcChannel(normalized);
    try {
      localStorage.setItem('whylowdps_simc_channel', normalized);
    } catch {}
  }, []);

  const setAutoClipboardPasteSimc = useCallback((v: boolean) => {
    _setAutoClipboardPasteSimc(v);
    try {
      localStorage.setItem('whylowdps_auto_clipboard_paste_simc', String(v));
    } catch {}
  }, []);

  const setDataCacheRefreshMinutes = useCallback((v: number) => {
    _setDataCacheRefreshMinutes(v);
    try {
      if (v > 0) {
        localStorage.setItem('whylowdps_data_cache_refresh_minutes', String(v));
      } else {
        localStorage.removeItem('whylowdps_data_cache_refresh_minutes');
      }
    } catch {}
  }, []);

  const parseSyncStatus = useCallback((status: any): string => {
    if (typeof status === 'string') return status;
    if (status && typeof status === 'object' && status.error)
      return `error:${String(status.error)}`;
    return 'unknown';
  }, []);

  const pollCacheStatus = useCallback(async () => {
    try {
      const data = await fetchJson<any>(`${API_URL}/api/data/status`);
      const status = parseSyncStatus(data.status);
      window.dispatchEvent(
        new CustomEvent('whylowdps-cache-refresh-status', {
          detail: { status, progress: data.progress || '', message: data.message || '' },
        })
      );

      if (status === 'ready' || status.startsWith('error:') || status === 'needs_credentials') {
        return;
      }

      window.setTimeout(() => {
        void pollCacheStatus();
      }, 1500);
    } catch (err: any) {
      window.dispatchEvent(
        new CustomEvent('whylowdps-cache-refresh-status', {
          detail: { status: 'error', message: err?.message || 'Failed to read cache status.' },
        })
      );
    }
  }, [parseSyncStatus]);

  useEffect(() => {
    const onCacheRefreshStart = () => {
      void pollCacheStatus();
    };
    window.addEventListener('whylowdps-cache-refresh-start', onCacheRefreshStart as EventListener);
    return () => {
      window.removeEventListener(
        'whylowdps-cache-refresh-start',
        onCacheRefreshStart as EventListener
      );
    };
  }, [pollCacheStatus]);

  useEffect(() => {
    if (dataCacheRefreshMinutes <= 0) return;
    let cancelled = false;
    let timer: number | null = null;
    const refreshKey = 'whylowdps_data_cache_last_auto_refresh_at';

    const triggerRefresh = async () => {
      try {
        try {
          localStorage.setItem(refreshKey, String(Date.now()));
        } catch {}
        window.dispatchEvent(new CustomEvent('whylowdps-cache-refresh-start'));
        await fetchJson(`${API_URL}/api/data/sync?force=true`, { method: 'POST' });
      } catch (err: any) {
        if (err?.status !== 409) {
          console.warn('Auto cache refresh failed:', err);
        }
      }
    };

    try {
      const rawLast = localStorage.getItem(refreshKey);
      const lastMs = rawLast ? Number(rawLast) : 0;
      const nowMs = Date.now();
      const intervalMs = dataCacheRefreshMinutes * 60 * 1000;
      if (!Number.isFinite(lastMs) || lastMs <= 0 || nowMs - lastMs >= intervalMs) {
        void triggerRefresh();
      }
    } catch {
      void triggerRefresh();
    }

    timer = window.setInterval(
      () => {
        if (cancelled) return;
        void triggerRefresh();
      },
      dataCacheRefreshMinutes * 60 * 1000
    );

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [dataCacheRefreshMinutes, pollCacheStatus]);

  return (
    <SimContext.Provider
      value={{
        simcInput,
        setSimcInput,
        fightStyle,
        setFightStyle,
        threads,
        setThreads,
        maxCombinations,
        setMaxCombinations,
        selectedTalent,
        setSelectedTalent,
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
        externalBuffBlessingOfBronze,
        setExternalBuffBlessingOfBronze,
        externalBuffAugmentation,
        setExternalBuffAugmentation,
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
        setLockSingleConsumableOptions,
        autoClipboardPasteSimc,
        setAutoClipboardPasteSimc,
        dataCacheRefreshMinutes,
        setDataCacheRefreshMinutes,
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
        talentBuilds,
        setTalentBuilds,
        scenarios,
        addScenario,
        removeScenario,
        clearScenarios,
      }}
    >
      {children}
    </SimContext.Provider>
  );
}
