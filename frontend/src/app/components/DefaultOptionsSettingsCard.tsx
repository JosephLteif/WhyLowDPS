'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSimContext } from './SimContext';
import FightStyleSelector from './FightStyleSelector';
import { getFightStyleParamRules } from '../lib/fight-style';
import { RAID_BUFF_MATRIX_OPTIONS } from '../lib/sim-options-catalog';
import { useConsumableOptions } from '../lib/useConsumableOptions';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import { API_URL, fetchJson } from '../lib/api';
import ConsumableSelect, { buildQualityMaxByFamily } from './shared/ConsumableSelect';
import RaidBuffGrid from './shared/RaidBuffGrid';
import ToggleOptionCard from './shared/ToggleOptionCard';
import {
  buildCharacterDefaultsKey,
  clearCharacterDefaultOption,
  getAllAppDefaultOptions,
  getCharacterDefaultsKeyFromSimcInput,
  getLastActiveCharacterDefaultsKey,
  isCharacterDefaultOverridden,
  resetCharacterAppDefaultOptions,
  resetGlobalAppDefaultOptions,
  resetAllAppDefaultOptions,
  setAppDefaultOption,
  setLastActiveCharacterDefaultsKey,
  type AppDefaultKey,
  type AppDefaultValues,
} from '../lib/default-options';

interface BnetCharacter {
  name: string;
  realm: string;
  region: string;
  class?: string;
  spec?: string;
}

export default function DefaultOptionsSettingsCard() {
  const { simcInput } = useSimContext();
  const { flasks, foods, potions, augments, tempEnchants } = useConsumableOptions(11);
  const activeCharacterKey = getCharacterDefaultsKeyFromSimcInput(simcInput);
  const rememberedCharacterKey = getLastActiveCharacterDefaultsKey();
  const [selectedCharacterKey, setSelectedCharacterKey] = useState<string | null>(
    activeCharacterKey || rememberedCharacterKey
  );
  const [roster, setRoster] = useState<BnetCharacter[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const characterKey = selectedCharacterKey;
  const [scope, setScope] = useState<'global' | 'character'>('global');
  const [defaults, setDefaults] = useState<AppDefaultValues>(() => getAllAppDefaultOptions());
  const [savedNotice, setSavedNotice] = useState(false);
  const canUseCharacterScope = !!characterKey;

  useEffect(() => {
    if (activeCharacterKey && !selectedCharacterKey) {
      setSelectedCharacterKey(activeCharacterKey);
      setLastActiveCharacterDefaultsKey(activeCharacterKey);
    }
  }, [activeCharacterKey, selectedCharacterKey]);

  useEffect(() => {
    let cancelled = false;
    setRosterLoading(true);
    fetchJson<{ characters?: BnetCharacter[] }>(`${API_URL}/api/bnet/user/characters`)
      .then((data) => {
        if (cancelled) return;
        const chars = Array.isArray(data?.characters) ? data.characters : [];
        setRoster(chars);
        if (!selectedCharacterKey && chars.length > 0) {
          const first = chars[0];
          const firstKey = buildCharacterDefaultsKey(first.region, first.realm, first.name);
          if (firstKey) {
            setSelectedCharacterKey(firstKey);
            setLastActiveCharacterDefaultsKey(firstKey);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setRoster([]);
      })
      .finally(() => {
        if (!cancelled) setRosterLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshDefaults = useCallback(() => {
    setDefaults(
      getAllAppDefaultOptions({
        characterKey: scope === 'character' ? characterKey : null,
      })
    );
  }, [scope, characterKey]);

  useEffect(() => {
    if (scope === 'character' && !canUseCharacterScope) {
      setScope('global');
      return;
    }
    refreshDefaults();
  }, [scope, canUseCharacterScope, refreshDefaults]);

  const updateDefault = useCallback(<K extends AppDefaultKey>(key: K, value: AppDefaultValues[K]) => {
    if (scope === 'character' && !characterKey) return;
    setAppDefaultOption(key, value, {
      scope,
      characterKey,
    });
    refreshDefaults();
    setSavedNotice(true);
  }, [scope, characterKey, refreshDefaults]);

  const clearCharacterOverride = useCallback(
    (key: AppDefaultKey) => {
      if (!characterKey) return;
      clearCharacterDefaultOption(key, characterKey);
      refreshDefaults();
      setSavedNotice(true);
    },
    [characterKey, refreshDefaults]
  );

  const resetDefaults = useCallback(() => {
    if (scope === 'character') {
      if (!characterKey) return;
      resetCharacterAppDefaultOptions(characterKey);
    } else {
      resetGlobalAppDefaultOptions();
    }
    refreshDefaults();
    setSavedNotice(true);
  }, [scope, characterKey, refreshDefaults]);

  const resetEverything = useCallback(() => {
    resetAllAppDefaultOptions();
    refreshDefaults();
    setSavedNotice(true);
  }, [refreshDefaults]);

  useEffect(() => {
    if (!savedNotice) return;
    const id = window.setTimeout(() => setSavedNotice(false), 1800);
    return () => window.clearTimeout(id);
  }, [savedNotice]);

  const isInherited = useCallback(
    (key: AppDefaultKey) => {
      if (scope !== 'character' || !characterKey) return false;
      return !isCharacterDefaultOverridden(key, characterKey);
    },
    [scope, characterKey]
  );

  const optionTitle = useCallback(
    (key: AppDefaultKey, baseTitle: string) =>
      isInherited(key) ? `${baseTitle} (Inheriting Global)` : baseTitle,
    [isInherited]
  );
  const topGearGlobalAffixesEnabled = Boolean(defaults['topgear.globalAffixes']);

  const fightStyleRules = getFightStyleParamRules(defaults['fight.fightStyle']);
  const qualityMaxByFamily = useMemo(
    () => buildQualityMaxByFamily([flasks, potions, augments, tempEnchants]),
    [flasks, potions, augments, tempEnchants]
  );

  const raidBuffBindings: Array<{ key: AppDefaultKey; label: string; icon: string; spellId: number }> =
    useMemo(
      () =>
        RAID_BUFF_MATRIX_OPTIONS.map((buff) => ({
          key:
            buff.key === 'bloodlust'
              ? 'raid.bloodlust'
              : buff.key === 'arcane_intellect'
                ? 'raid.arcaneIntellect'
                : buff.key === 'power_word_fortitude'
                  ? 'raid.powerWordFortitude'
                  : buff.key === 'mark_of_the_wild'
                    ? 'raid.markOfTheWild'
                    : buff.key === 'battle_shout'
                      ? 'raid.battleShout'
                      : buff.key === 'mystic_touch'
                        ? 'raid.mysticTouch'
                        : buff.key === 'chaos_brand'
                          ? 'raid.chaosBrand'
                          : buff.key === 'skyfury'
                            ? 'raid.skyfury'
                            : buff.key === 'hunters_mark'
                              ? 'raid.huntersMark'
                              : buff.key === 'power_infusion'
                                ? 'raid.powerInfusion'
                                : 'raid.bleeding',
          label: buff.label,
          icon: buff.icon,
          spellId: buff.spellId || 0,
        })),
      []
    );
  useWowheadTooltips([defaults]);

  return (
    <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-white">Default Options</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Startup defaults for Top Gear, Drop Finder, Fight Setup, Consumables, and Raid Buffs.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setScope('global')}
                className={`rounded-md border px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                  scope === 'global'
                    ? 'border-gold/45 bg-gold/[0.12] text-gold'
                    : 'border-zinc-600 bg-zinc-900/70 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800'
                }`}
              >
                Global Defaults
              </button>
              <button
                type="button"
                disabled={!canUseCharacterScope}
                onClick={() => setScope('character')}
                className={`rounded-md border px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                  scope === 'character'
                    ? 'border-gold/45 bg-gold/[0.12] text-gold'
                    : 'border-zinc-600 bg-zinc-900/70 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800'
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                Character Overrides
              </button>
            </div>
            {scope === 'character' && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[12px] text-zinc-400">Character:</span>
                <select
                  value={selectedCharacterKey || ''}
                  onChange={(e) => {
                    const next = e.target.value || null;
                    setSelectedCharacterKey(next);
                    if (next) setLastActiveCharacterDefaultsKey(next);
                  }}
                  className="rounded-md border border-border/50 bg-surface-2 px-2.5 py-1 text-[12px] text-zinc-200 focus:border-gold/50 focus:outline-none"
                >
                  {!canUseCharacterScope && <option value="">Select character...</option>}
                  {roster.map((char) => {
                    const key = buildCharacterDefaultsKey(char.region, char.realm, char.name);
                    if (!key) return null;
                    const label = `${char.name} - ${char.realm} (${char.region?.toUpperCase() || 'NA'})`;
                    return (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    );
                  })}
                </select>
                {rosterLoading && <span className="text-[12px] text-zinc-500">Loading roster...</span>}
              </div>
            )}
            {scope === 'character' && !canUseCharacterScope && (
              <p className="mt-2 text-[12px] text-zinc-500">
                Character overrides become available after loading a character profile.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {savedNotice && (
              <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[12px] font-semibold text-emerald-300">
                Defaults Saved
              </span>
            )}
            <button
              type="button"
              onClick={resetDefaults}
              className="rounded-md border border-zinc-600 bg-zinc-900/70 px-2.5 py-1 text-[12px] font-semibold text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
            >
              {scope === 'character' ? 'Clear Character Overrides' : 'Reset Global Defaults'}
            </button>
            <button
              type="button"
              onClick={resetEverything}
              className="rounded-md border border-red-700/40 bg-red-950/25 px-2.5 py-1 text-[12px] font-semibold text-red-300 transition-colors hover:bg-red-900/30"
            >
              Reset All
            </button>
          </div>
        </div>

        <div className="card flex flex-col gap-4 p-5 sm:flex-row">
          <ToggleOptionCard
            checked={defaults['topgear.globalAffixes']}
            onToggle={() => updateDefault('topgear.globalAffixes', !defaults['topgear.globalAffixes'])}
            title={optionTitle('topgear.globalAffixes', 'Global Enchants & Gems')}
            description="Manage enchants and gems centrally with Enchant & Gem Rules by default"
            note={
              scope === 'character' ? (
                isInherited('topgear.globalAffixes') ? (
                  <span className="text-zinc-500">Inheriting from global defaults</span>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      clearCharacterOverride('topgear.globalAffixes');
                    }}
                    className="text-[12px] font-semibold text-gold hover:text-gold/80"
                  >
                    Use Global
                  </button>
                )
              ) : null
            }
          />
          <ToggleOptionCard
            checked={topGearGlobalAffixesEnabled ? false : defaults['topgear.copyEnchants']}
            onToggle={() => {
              if (topGearGlobalAffixesEnabled) return;
              updateDefault('topgear.copyEnchants', !defaults['topgear.copyEnchants']);
            }}
            disabled={topGearGlobalAffixesEnabled}
            title={optionTitle('topgear.copyEnchants', 'Copy Enchants/Gems')}
            description={
              topGearGlobalAffixesEnabled
                ? 'Disabled while Global Enchants & Gems is enabled because central rules override affixes'
                : "Apply equipped enchants and gems to items that don't have one"
            }
            note={
              scope === 'character' ? (
                isInherited('topgear.copyEnchants') ? (
                  <span className="text-zinc-500">Inheriting from global defaults</span>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      clearCharacterOverride('topgear.copyEnchants');
                    }}
                    className="text-[12px] font-semibold text-gold hover:text-gold/80"
                  >
                    Use Global
                  </button>
                )
              ) : null
            }
          />
          <ToggleOptionCard
            checked={defaults['topgear.maxUpgrade']}
            onToggle={() => updateDefault('topgear.maxUpgrade', !defaults['topgear.maxUpgrade'])}
            title={optionTitle('topgear.maxUpgrade', 'Sim Highest Upgrade')}
            description="Treat all selected gear as their maximum upgrade level"
            note={
              scope === 'character' ? (
                isInherited('topgear.maxUpgrade') ? (
                  <span className="text-zinc-500">Inheriting from global defaults</span>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      clearCharacterOverride('topgear.maxUpgrade');
                    }}
                    className="text-[12px] font-semibold text-gold hover:text-gold/80"
                  >
                    Use Global
                  </button>
                )
              ) : null
            }
          />
          <ToggleOptionCard
            checked={defaults['topgear.catalyst']}
            onToggle={() => updateDefault('topgear.catalyst', !defaults['topgear.catalyst'])}
            title={optionTitle('topgear.catalyst', 'Revival Catalyst')}
            description="Convert highest item per slot"
            note={
              scope === 'character' ? (
                isInherited('topgear.catalyst') ? (
                  <span className="text-zinc-500">Inheriting from global defaults</span>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      clearCharacterOverride('topgear.catalyst');
                    }}
                    className="text-[12px] font-semibold text-gold hover:text-gold/80"
                  >
                    Use Global
                  </button>
                )
              ) : null
            }
          />
        </div>

        <div className="card space-y-4 p-5">
          <div>
            <p className="text-[15px] font-medium text-zinc-100">Drop Finder</p>
            <p className="text-[14px] text-zinc-300">Configure default behavior for Drop Finder options.</p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="label-text">
                  {optionTitle('dropfinder.upgradeMode', 'Upgrade Simulation Mode')}
                </label>
                {scope === 'character' && !isInherited('dropfinder.upgradeMode') && (
                  <button
                    type="button"
                    onClick={() => clearCharacterOverride('dropfinder.upgradeMode')}
                    className="text-[11px] font-semibold text-gold hover:text-gold/80"
                  >
                    Use Global
                  </button>
                )}
              </div>
              <select
                value={defaults['dropfinder.upgradeMode']}
                onChange={(e) => updateDefault('dropfinder.upgradeMode', e.target.value)}
                className="input-field w-full"
              >
                <option value="current">Current only</option>
                <option value="highest">Highest only</option>
                <option value="both">Current + Highest</option>
              </select>
            </div>

            {(
              [
                [
                  'dropfinder.autoCatalyst',
                  'Auto Catalyst',
                  'Add catalyst-converted alternatives for eligible items.',
                ],
                [
                  'dropfinder.copyEnchants',
                  'Copy Enchants/Gems',
                  "Apply equipped enchants and gems to items that don't have one.",
                ],
              ] as const
            ).map(([key, title, desc]) => (
              <ToggleOptionCard
                key={key}
                checked={defaults[key]}
                onToggle={() => updateDefault(key, !defaults[key])}
                title={optionTitle(key, title)}
                description={desc}
                note={
                  scope === 'character' ? (
                    isInherited(key) ? (
                      <span className="text-zinc-500">Inheriting from global defaults</span>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          clearCharacterOverride(key);
                        }}
                        className="text-[12px] font-semibold text-gold hover:text-gold/80"
                      >
                        Use Global
                      </button>
                    )
                  ) : null
                }
              />
            ))}
          </div>
        </div>

        <div className="card space-y-4 p-5">
          <div>
            <p className="text-[15px] font-medium text-zinc-100">Fight Setup</p>
            <p className="text-[14px] text-zinc-300">Configure fight style defaults.</p>
          </div>

          <div
            className={`grid gap-4 ${
              fightStyleRules.usesFightLength && fightStyleRules.usesTargetCount
                ? 'grid-cols-3'
                : fightStyleRules.usesFightLength || fightStyleRules.usesTargetCount
                  ? 'grid-cols-2'
                  : 'grid-cols-1'
            }`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="label-text">{optionTitle('fight.fightStyle', 'Fight Style')}</label>
                {scope === 'character' && !isInherited('fight.fightStyle') && (
                  <button
                    type="button"
                    onClick={() => clearCharacterOverride('fight.fightStyle')}
                    className="text-[11px] font-semibold text-gold hover:text-gold/80"
                  >
                    Use Global
                  </button>
                )}
              </div>
              <FightStyleSelector
                value={defaults['fight.fightStyle']}
                onChange={(value) => updateDefault('fight.fightStyle', value)}
              />
            </div>

            {fightStyleRules.usesFightLength && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="label-text">
                    {optionTitle('fight.fightLength', 'Fight Length')}
                  </label>
                  {scope === 'character' && !isInherited('fight.fightLength') && (
                    <button
                      type="button"
                      onClick={() => clearCharacterOverride('fight.fightLength')}
                      className="text-[11px] font-semibold text-gold hover:text-gold/80"
                    >
                      Use Global
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={30}
                    max={600}
                    step={30}
                    value={defaults['fight.fightLength']}
                    onChange={(e) => updateDefault('fight.fightLength', Number(e.target.value))}
                    className="flex-1 accent-gold"
                  />
                  <span className="w-16 text-right font-mono text-sm tabular-nums text-white">
                    {Math.floor(defaults['fight.fightLength'] / 60)}:
                    {String(defaults['fight.fightLength'] % 60).padStart(2, '0')}
                  </span>
                </div>
              </div>
            )}

            {fightStyleRules.usesTargetCount && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="label-text">
                    {optionTitle('fight.targetCount', 'Number of Bosses')}
                  </label>
                  {scope === 'character' && !isInherited('fight.targetCount') && (
                    <button
                      type="button"
                      onClick={() => clearCharacterOverride('fight.targetCount')}
                      className="text-[11px] font-semibold text-gold hover:text-gold/80"
                    >
                      Use Global
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={defaults['fight.targetCount']}
                    onChange={(e) => updateDefault('fight.targetCount', Number(e.target.value))}
                    className="flex-1 accent-gold"
                  />
                  <span className="w-6 text-right font-mono text-sm tabular-nums text-white">
                    {defaults['fight.targetCount']}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="card space-y-5 p-5">
          <div>
            <p className="text-[15px] font-medium text-zinc-100">Consumables</p>
            <p className="text-[14px] text-zinc-300">Default consumables for new simulations.</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
              <p className="text-[13px] font-semibold uppercase tracking-wider text-zinc-300">Flask</p>
              <ConsumableSelect
                label={optionTitle('consumable.flask', 'Active Flask')}
                value={defaults['consumable.flask']}
                onChange={(v) => updateDefault('consumable.flask', v)}
                options={flasks}
                qualityMaxByFamily={qualityMaxByFamily}
              />
              {scope === 'character' && !isInherited('consumable.flask') && (
                <button
                  type="button"
                  onClick={() => clearCharacterOverride('consumable.flask')}
                  className="text-[11px] font-semibold text-gold hover:text-gold/80"
                >
                  Use Global
                </button>
              )}
            </div>
            <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
              <p className="text-[13px] font-semibold uppercase tracking-wider text-zinc-300">Potion</p>
              <ConsumableSelect
                label={optionTitle('consumable.potion', 'Active Potion')}
                value={defaults['consumable.potion']}
                onChange={(v) => updateDefault('consumable.potion', v)}
                options={potions}
                qualityMaxByFamily={qualityMaxByFamily}
              />
              {scope === 'character' && !isInherited('consumable.potion') && (
                <button
                  type="button"
                  onClick={() => clearCharacterOverride('consumable.potion')}
                  className="text-[11px] font-semibold text-gold hover:text-gold/80"
                >
                  Use Global
                </button>
              )}
            </div>
            <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
              <p className="text-[13px] font-semibold uppercase tracking-wider text-zinc-300">Augmentation Rune</p>
              <ConsumableSelect
                label={optionTitle('consumable.augmentation', 'Active Augmentation Rune')}
                value={defaults['consumable.augmentation']}
                onChange={(v) => updateDefault('consumable.augmentation', v)}
                options={augments}
                qualityMaxByFamily={qualityMaxByFamily}
              />
              {scope === 'character' && !isInherited('consumable.augmentation') && (
                <button
                  type="button"
                  onClick={() => clearCharacterOverride('consumable.augmentation')}
                  className="text-[11px] font-semibold text-gold hover:text-gold/80"
                >
                  Use Global
                </button>
              )}
            </div>
            <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
              <p className="text-[13px] font-semibold uppercase tracking-wider text-zinc-300">Temporary Enchant</p>
              <ConsumableSelect
                label={optionTitle('consumable.temporaryEnchant', 'Main Hand Temporary Enchant')}
                value={defaults['consumable.temporaryEnchant']}
                onChange={(v) => updateDefault('consumable.temporaryEnchant', v)}
                options={tempEnchants}
                qualityMaxByFamily={qualityMaxByFamily}
              />
              {scope === 'character' && !isInherited('consumable.temporaryEnchant') && (
                <button
                  type="button"
                  onClick={() => clearCharacterOverride('consumable.temporaryEnchant')}
                  className="text-[11px] font-semibold text-gold hover:text-gold/80"
                >
                  Use Global
                </button>
              )}
            </div>
            <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
              <p className="text-[13px] font-semibold uppercase tracking-wider text-zinc-300">Food</p>
              <ConsumableSelect
                label={optionTitle('consumable.food', 'Active Food Buff')}
                value={defaults['consumable.food']}
                onChange={(v) => updateDefault('consumable.food', v)}
                options={foods}
                qualityMaxByFamily={qualityMaxByFamily}
              />
              {scope === 'character' && !isInherited('consumable.food') && (
                <button
                  type="button"
                  onClick={() => clearCharacterOverride('consumable.food')}
                  className="text-[11px] font-semibold text-gold hover:text-gold/80"
                >
                  Use Global
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="card space-y-3 p-5">
          <div>
            <p className="text-[15px] font-medium text-zinc-100">Raid Buffs</p>
            <p className="text-[14px] text-zinc-300">Default raid buffs for normal sims.</p>
          </div>
          <RaidBuffGrid
            entries={raidBuffBindings.map((buff) => ({
              id: buff.key,
              label: optionTitle(buff.key, buff.label),
              spellId: buff.spellId,
              icon: buff.icon,
              checked: Boolean(defaults[buff.key]),
              onChange: (checked: boolean) => updateDefault(buff.key, checked),
            }))}
            onSelectAll={() => raidBuffBindings.forEach((b) => updateDefault(b.key, true))}
            onClear={() => raidBuffBindings.forEach((b) => updateDefault(b.key, false))}
          />
        </div>
      </div>
    </section>
  );
}
