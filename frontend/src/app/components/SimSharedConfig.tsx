'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSimContext } from './SimContext';
import FightStyleSelector from './FightStyleSelector';
import ScenarioBuilder from './ScenarioBuilder';
import TalentPicker from './TalentPicker';
import { specDisplayName } from '../lib/types';
import { getFightStyleParamRules } from '../lib/fight-style';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import { useConsumableOptions } from '../lib/useConsumableOptions';
import { OptionEntry, RAID_BUFF_MATRIX_OPTIONS } from '../lib/sim-options-catalog';

/** Adler-32 checksum matching the SimC addon's implementation.
 *  The Lua addon processes raw UTF-8 bytes, so we must do the same. */
function adler32(s: string): number {
  const prime = 65521;
  let s1 = 1;
  let s2 = 0;
  const bytes = new TextEncoder().encode(s);
  for (let i = 0; i < bytes.length; i++) {
    s1 = (s1 + bytes[i]) % prime;
    s2 = (s2 + s1) % prime;
  }
  return ((s2 << 16) | s1) >>> 0;
}

/** Validate the SimC addon checksum. Returns null if valid or no checksum present. */
function validateChecksum(input: string): 'valid' | 'invalid' | null {
  const match = input.match(/^#\s*Checksum:\s*([0-9a-fA-F]+)\s*$/m);
  if (!match) return null;
  const expected = parseInt(match[1], 16);
  // The checksum covers everything before the checksum line.
  // The SimC addon may compute with \r\n or \n line endings depending on OS.
  // Browsers normalize textarea input to \n, so try both.
  const idx = input.indexOf(match[0]);
  const body = input.substring(0, idx);
  if (adler32(body) === expected) return 'valid';
  if (adler32(body.replace(/\n/g, '\r\n')) === expected) return 'valid';
  return 'invalid';
}

function parseCharacterInfo(input: string) {
  if (!input) return null;
  const nameMatch = input.match(/^(\w+)="(.+)"$/m);
  const specMatch = input.match(/^spec=(\w+)/m);
  if (!nameMatch) return null;
  // Save last character to localStorage for history page
  const realmMatch = input.match(/^server=(.+)$/m);
  if (nameMatch[2] && realmMatch?.[1]) {
    try {
      localStorage.setItem(
        'whylowdps_last_character',
        JSON.stringify({ name: nameMatch[2], realm: realmMatch[1] })
      );
    } catch {}
  }
  return {
    className: nameMatch[1],
    name: nameMatch[2],
    spec: specMatch?.[1] || 'unknown',
  };
}

function looksLikeSimcInput(input: string) {
  const text = input.trim();
  if (text.length < 10) return false;

  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const hasChecksum = lines.some((line) => /^#\s*Checksum:/i.test(line));
  const hasSimcKeyValue = lines.some((line) =>
    /^(?:warrior|paladin|hunter|rogue|priest|death_knight|deathknight|shaman|mage|warlock|monk|druid|demon_hunter|demonhunter|evoker|player|name|server|region|spec|talents)\s*=/.test(
      line
    )
  );
  const hasArmoryLine = lines.some((line) => /^armory\s*=/.test(line));
  const hasCharacterHeader = lines.some((line) => /^\w+="[^"]+"/.test(line));

  return hasChecksum || hasArmoryLine || hasSimcKeyValue || hasCharacterHeader;
}

function ClipboardBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="pointer-events-auto w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-emerald-500/25 bg-zinc-950/95 p-4 text-sm text-emerald-100 shadow-2xl shadow-black/40 backdrop-blur-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
          <svg
            className="h-4 w-4"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6.5 8.5l1.5 1.5L11 7" />
            <circle cx="8" cy="8" r="6" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-emerald-100">Clipboard pasted</p>
          <p className="mt-1 text-[13px] leading-5 text-zinc-300">{message}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
          aria-label="Dismiss notification"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function renderSimcLine(line: string) {
  if (!line) return null;

  if (/^\s*#\s*Checksum:/i.test(line)) {
    return <span className="text-amber-300">{line}</span>;
  }
  if (/^\s*#/.test(line)) {
    return <span className="text-zinc-500">{line}</span>;
  }

  const kv = line.match(/^(\s*)([A-Za-z0-9_.-]+)(\s*=\s*)(.*)$/);
  if (!kv) return <span className="text-zinc-300">{line}</span>;

  const [, indent, key, sep, rawValue] = kv;
  const value =
    /^".*"$/.test(rawValue) || /^[A-Za-z_/-]+$/.test(rawValue)
      ? 'text-emerald-300'
      : /^(?:\d+(?:\.\d+)?)$/.test(rawValue)
        ? 'text-sky-300'
        : 'text-zinc-300';

  return (
    <>
      <span className="text-zinc-300">{indent}</span>
      <span className="text-gold">{key}</span>
      <span className="text-zinc-500">{sep}</span>
      <span className={value}>{rawValue}</span>
    </>
  );
}

function SimcInputEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const preRef = useRef<HTMLPreElement | null>(null);
  const editorHeight = expanded ? 'h-[28rem]' : 'h-40';

  const syncScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (!preRef.current) return;
    preRef.current.scrollTop = e.currentTarget.scrollTop;
    preRef.current.scrollLeft = e.currentTarget.scrollLeft;
  };

  const lines = value.split('\n');

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      <div className="relative w-full rounded-lg border border-border bg-surface-2 shadow-sm transition-all duration-150 focus-within:border-gold/50 focus-within:ring-2 focus-within:ring-gold/20">
        <pre
          ref={preRef}
          aria-hidden
          className={`${editorHeight} overflow-auto px-3.5 py-2.5 font-mono text-[13px] leading-relaxed`}
        >
          {value ? (
            lines.map((line, idx) => (
              <span key={idx}>
                {renderSimcLine(line)}
                {idx < lines.length - 1 ? '\n' : null}
              </span>
            ))
          ) : (
            <span className="text-zinc-500">{placeholder}</span>
          )}
        </pre>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          placeholder={placeholder}
          spellCheck={false}
          className={`absolute inset-0 ${editorHeight} w-full overflow-auto bg-transparent px-3.5 py-2.5 font-mono text-[13px] leading-relaxed text-transparent placeholder-zinc-500 caret-zinc-100 focus:outline-none`}
        />
      </div>
    </div>
  );
}

const EXPERT_TABS = [
  {
    key: 'header',
    label: 'Header',
    desc: 'Injected before the base actor. Use for global options and initial overrides.',
  },
  {
    key: 'base_player',
    label: 'Base Player',
    desc: 'Injected after the base actor definition. Use for custom APL (actions=...) or player-specific overrides.',
  },
  {
    key: 'raid_actors',
    label: 'Raid Actors',
    desc: 'Extremely experimental! Adds additional raid actors. Disables single_actor_batch when used.',
  },
  {
    key: 'post_combos',
    label: 'Post Combos',
    desc: 'Injected after all profileset combinations. Use for additional actors after gear combos.',
  },
  {
    key: 'footer',
    label: 'Footer',
    desc: 'Injected at the very end. Use for dungeon routes, fight overrides, or custom enemy configs.',
  },
] as const;

type ExpertTabKey = (typeof EXPERT_TABS)[number]['key'];

function CharacterInfoBar({ info }: { info: { className: string; name: string; spec: string } }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3.5 py-2">
      <div className="h-2 w-2 rounded-full bg-gold/70" />
      <p className="text-xs font-medium text-zinc-300">
        {info.name}
        <span className="ml-1.5 font-normal text-zinc-500">
          {specDisplayName(info.spec)} {info.className}
        </span>
      </p>
    </div>
  );
}

function optionQualityFamily(opt: OptionEntry | null) {
  const token = (opt?.token || '').replace(/^main_hand:/, '');
  return token.replace(/_[1-3]$/i, '');
}

function remapQuality(quality: number | undefined, familyMax: number | undefined) {
  if (!quality || quality < 1 || quality > 3) return undefined;
  // 2-tier groups: 1=silver, 2=gold
  if (familyMax === 2) {
    if (quality === 1) return 2;
    if (quality === 2) return 3;
  }
  // 3-tier groups: 1=bronze, 2=silver, 3=gold
  return quality;
}

function optionSelectLabel(opt: OptionEntry) {
  return (opt.label || '').replace(/\s*\(Quality\s*[1-3]\)\s*$/i, '').replace(/\s+[1-3]\s*$/i, '');
}

function QualityBadge({ quality }: { quality?: number }) {
  if (!quality || quality < 1 || quality > 3) return null;
  const style =
    quality === 3
      ? 'border-amber-300/60 bg-gradient-to-b from-amber-200 to-amber-500'
      : quality === 2
        ? 'border-zinc-300/60 bg-gradient-to-b from-zinc-100 to-zinc-400'
        : 'border-orange-400/60 bg-gradient-to-b from-orange-200 to-orange-500';
  return (
    <span
      className={`ml-auto inline-block h-3.5 w-3.5 rotate-45 rounded-[2px] border ${style}`}
      title={`Quality ${quality}`}
      aria-label={`Quality ${quality}`}
    >
      <span className="sr-only">{quality}</span>
    </span>
  );
}

function ConsumableSelect({
  label,
  value,
  onChange,
  options,
  qualityMaxByFamily,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: OptionEntry[];
  qualityMaxByFamily: Map<string, number>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useWowheadTooltips([open, value, options.length]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const selected = options.find((opt) => (opt.token || '') === value) || null;
  const selectedQuality = remapQuality(
    selected?.craftingQuality,
    qualityMaxByFamily.get(optionQualityFamily(selected))
  );

  return (
    <label className="space-y-1.5 text-xs text-zinc-400">
      <span className="block">{label}</span>
      <div ref={rootRef} className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className={`flex w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-left text-sm ${
            disabled ? 'cursor-not-allowed text-zinc-500 opacity-70' : 'text-zinc-200'
          }`}
        >
          {selected?.icon ? (
            <a
              href={selected.itemId ? `https://www.wowhead.com/item=${selected.itemId}` : '#'}
              target="_blank"
              rel="noreferrer"
              data-wowhead={selected.itemId ? `item=${selected.itemId}` : undefined}
              onClick={(e) => e.preventDefault()}
              className="h-4 w-4 shrink-0 rounded-[3px] bg-cover bg-center"
              style={{
                backgroundImage: `url(https://wow.zamimg.com/images/wow/icons/small/${selected.icon}.jpg)`,
              }}
            />
          ) : (
            <span className="h-4 w-4 shrink-0 rounded-[3px] border border-border bg-surface-2" />
          )}
          {selected ? (
            <a
              href={selected.itemId ? `https://www.wowhead.com/item=${selected.itemId}` : '#'}
              target="_blank"
              rel="noreferrer"
              data-wowhead={selected.itemId ? `item=${selected.itemId}` : undefined}
              onClick={(e) => e.preventDefault()}
              className="truncate"
            >
              {optionSelectLabel(selected)}
            </a>
          ) : (
            <span className="truncate">None</span>
          )}
          <QualityBadge quality={selectedQuality} />
          <svg
            className={`ml-1 h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
        {open && (
          <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-surface shadow-xl">
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left text-sm text-zinc-300 hover:bg-white/[0.04]"
            >
              <span className="h-4 w-4 shrink-0 rounded-[3px] border border-border bg-surface-2" />
              <span className="truncate">None</span>
            </button>
            {options.map((opt) => {
              const q = remapQuality(
                opt.craftingQuality,
                qualityMaxByFamily.get(optionQualityFamily(opt))
              );
              return (
                <div
                  key={opt.key}
                  onClick={() => {
                    onChange(opt.token || '');
                    setOpen(false);
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left text-sm text-zinc-300 hover:bg-white/[0.04]"
                >
                  <a
                    href={opt.itemId ? `https://www.wowhead.com/item=${opt.itemId}` : '#'}
                    target="_blank"
                    rel="noreferrer"
                    data-wowhead={opt.itemId ? `item=${opt.itemId}` : undefined}
                    onClick={(e) => e.preventDefault()}
                    className="h-4 w-4 shrink-0 rounded-[3px] bg-cover bg-center"
                    style={{
                      backgroundImage: `url(https://wow.zamimg.com/images/wow/icons/small/${opt.icon}.jpg)`,
                    }}
                  />
                  <a
                    href={opt.itemId ? `https://www.wowhead.com/item=${opt.itemId}` : '#'}
                    target="_blank"
                    rel="noreferrer"
                    data-wowhead={opt.itemId ? `item=${opt.itemId}` : undefined}
                    onClick={(e) => e.preventDefault()}
                    className="truncate"
                  >
                    {optionSelectLabel(opt)}
                  </a>
                  <QualityBadge quality={q} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </label>
  );
}

function AdvancedOptions() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ExpertTabKey>('footer');
  const {
    fightStyle,
    setFightStyle,
    targetCount,
    setTargetCount,
    fightLength,
    setFightLength,
    customApl,
    setCustomApl,
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
  } = useSimContext();

  const expertValues: Record<ExpertTabKey, string> = useMemo(
    () => ({
      header: simcHeader,
      base_player: simcBasePlayer,
      raid_actors: simcRaidActors,
      post_combos: simcPostCombos,
      footer: simcFooter,
    }),
    [simcHeader, simcBasePlayer, simcRaidActors, simcPostCombos, simcFooter]
  );

  const expertSetters: Record<ExpertTabKey, (v: string) => void> = useMemo(
    () => ({
      header: setSimcHeader,
      base_player: setSimcBasePlayer,
      raid_actors: setSimcRaidActors,
      post_combos: setSimcPostCombos,
      footer: setSimcFooter,
    }),
    [setSimcHeader, setSimcBasePlayer, setSimcRaidActors, setSimcPostCombos, setSimcFooter]
  );

  const hasExpertContent = Object.values(expertValues).some((v) => v.trim());
  const { flasks, foods, potions, augments, tempEnchants } = useConsumableOptions(10);
  const selectedFlaskOption = flasks.find((opt) => (opt.token || '') === consumableFlask) || null;
  const selectedPotionOption =
    potions.find((opt) => (opt.token || '') === consumablePotion) || null;
  const selectedAugmentationOption =
    augments.find((opt) => (opt.token || '') === consumableAugmentation) || null;
  const selectedTempEnchantOption =
    tempEnchants.find((opt) => (opt.token || '') === consumableTemporaryEnchant) || null;
  const qualityMaxByFamily = useMemo(() => {
    const map = new Map<string, number>();
    const all = [...flasks, ...potions, ...augments, ...tempEnchants];
    for (const opt of all) {
      const family = optionQualityFamily(opt);
      const q = opt.craftingQuality || 0;
      map.set(family, Math.max(map.get(family) || 0, q));
    }
    return map;
  }, [flasks, potions, augments, tempEnchants]);
  const fightStyleRules = getFightStyleParamRules(fightStyle);
  const showFightLength = fightStyleRules.usesFightLength;
  const showTargetCount = fightStyleRules.usesTargetCount;
  const isDefault =
    fightStyle === 'Patchwerk' &&
    (!showTargetCount || targetCount === 1) &&
    (!showFightLength || fightLength === 300) &&
    !customApl &&
    !hasExpertContent;
  const activeTabInfo = EXPERT_TABS.find((t) => t.key === activeTab)!;
  useWowheadTooltips([
    open,
    externalBuffChaosBrand,
    externalBuffMysticTouch,
    externalBuffSkyfury,
    externalBuffPowerInfusion,
    raidBuffBloodlust,
    raidBuffArcaneIntellect,
    raidBuffPowerWordFortitude,
    raidBuffMarkOfTheWild,
    raidBuffBattleShout,
    raidBuffHuntersMark,
    raidBuffBleeding,
    consumableFlask,
    consumablePotion,
    consumableAugmentation,
    consumableTemporaryEnchant,
    consumableFood,
  ]);

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-3.5 transition-colors hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-2.5">
          <svg
            className="h-4 w-4 text-zinc-500"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="8" cy="8" r="2" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
          </svg>
          <span className="text-sm font-medium text-zinc-300">Advanced Options</span>
          {!open && !isDefault && (
            <span className="rounded-md bg-gold/10 px-1.5 py-0.5 text-[12px] font-medium text-gold">
              Modified
            </span>
          )}
        </div>
        <svg
          className={`h-3.5 w-3.5 text-zinc-600 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="animate-fade-in space-y-5 border-t border-border px-5 pb-5">
          <div
            className={`grid gap-4 pt-4 ${
              showFightLength && showTargetCount
                ? 'grid-cols-3'
                : showFightLength || showTargetCount
                  ? 'grid-cols-2'
                  : 'grid-cols-1'
            }`}
          >
            <div className="space-y-2">
              <label className="label-text">Fight Style</label>
              <FightStyleSelector value={fightStyle} onChange={setFightStyle} />
            </div>

            {showFightLength && (
              <div className="space-y-2">
                <label className="label-text">Fight Length</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={30}
                    max={600}
                    step={30}
                    value={fightLength}
                    onChange={(e) => setFightLength(Number(e.target.value))}
                    className="flex-1 accent-gold"
                  />
                  <span className="w-16 text-right font-mono text-sm tabular-nums text-white">
                    {Math.floor(fightLength / 60)}:{String(fightLength % 60).padStart(2, '0')}
                  </span>
                </div>
              </div>
            )}

            {showTargetCount && (
              <div className="space-y-2">
                <label className="label-text">Number of Bosses</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={targetCount}
                    onChange={(e) => setTargetCount(Number(e.target.value))}
                    className="flex-1 accent-gold"
                  />
                  <span className="w-6 text-right font-mono text-sm tabular-nums text-white">
                    {targetCount}
                  </span>
                </div>
              </div>
            )}

            {!showFightLength && !showTargetCount && (
              <div className="text-[13px] text-zinc-500">
                This fight style uses built-in timing and target scripting.
              </div>
            )}
          </div>

          <ScenarioBuilder />

          {/* Custom APL */}
          <div className="space-y-2">
            <label className="label-text">Custom APL / SimC Options</label>
            <textarea
              value={customApl}
              onChange={(e) => setCustomApl(e.target.value)}
              placeholder="Custom APL or expansion options (e.g., actions=..., midnight.*, use_blizzard_action_list=1)..."
              className="input-field h-28 resize-y font-mono text-xs"
            />
            <p className="text-[13px] text-zinc-600">
              Override action priority lists or set expansion-specific options. Injected after the
              base actor.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/70 bg-surface-2/70 px-3.5 py-2.5">
            <div>
              <p className="text-sm font-medium text-zinc-200">Timeline &amp; APL Analyzer</p>
              <p className="text-[13px] text-zinc-500">
                Include action sequence, cooldown timing, and buff uptime data in sim results.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIncludeTimeline(!includeTimeline)}
              className={`relative h-5 w-9 rounded-full transition-colors ${
                includeTimeline ? 'bg-gold' : 'border border-border bg-surface'
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
                  includeTimeline ? 'left-[18px] bg-black' : 'left-0.5 bg-gray-500'
                }`}
              />
            </button>
          </div>

          <div className="space-y-3 rounded-lg border border-border/70 bg-surface-2/70 p-3.5">
            <div>
              <p className="text-sm font-medium text-zinc-200">Consumables</p>
              <p className="text-[13px] text-zinc-500">
                Select one per category for normal sims. Use Stat Weights matrix to compare many at
                once.
              </p>
              {lockSingleConsumableOptions && (
                <p className="mt-1 text-[12px] text-amber-300">
                  Disabled while Consumable Matrix mode is selected.
                </p>
              )}
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Flask
                </p>
                <ConsumableSelect
                  label="Active Flask"
                  value={consumableFlask}
                  onChange={setConsumableFlask}
                  options={flasks}
                  qualityMaxByFamily={qualityMaxByFamily}
                  disabled={lockSingleConsumableOptions}
                />
              </div>

              <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Potion
                </p>
                <ConsumableSelect
                  label="Active Potion"
                  value={consumablePotion}
                  onChange={setConsumablePotion}
                  options={potions}
                  qualityMaxByFamily={qualityMaxByFamily}
                  disabled={lockSingleConsumableOptions}
                />
              </div>

              <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Augmentation Rune
                </p>
                <ConsumableSelect
                  label="Active Augmentation Rune"
                  value={consumableAugmentation}
                  onChange={setConsumableAugmentation}
                  options={augments}
                  qualityMaxByFamily={qualityMaxByFamily}
                  disabled={lockSingleConsumableOptions}
                />
              </div>

              <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Temporary Enchant
                </p>
                <ConsumableSelect
                  label="Main Hand Temporary Enchant"
                  value={consumableTemporaryEnchant}
                  onChange={setConsumableTemporaryEnchant}
                  options={tempEnchants}
                  qualityMaxByFamily={qualityMaxByFamily}
                  disabled={lockSingleConsumableOptions}
                />
              </div>

              <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Food</p>
                <ConsumableSelect
                  label="Active Food Buff"
                  value={consumableFood}
                  onChange={setConsumableFood}
                  options={foods}
                  qualityMaxByFamily={qualityMaxByFamily}
                  disabled={lockSingleConsumableOptions}
                />
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border/70 bg-surface-2/70 p-3.5">
            <div>
              <p className="text-sm font-medium text-zinc-200">Raid Buffs</p>
              <p className="text-[13px] text-zinc-500">
                Control default raid buffs for normal sims.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {RAID_BUFF_MATRIX_OPTIONS.map((buff) => {
                const checked =
                  buff.key === 'bloodlust'
                    ? raidBuffBloodlust
                    : buff.key === 'arcane_intellect'
                      ? raidBuffArcaneIntellect
                      : buff.key === 'power_word_fortitude'
                        ? raidBuffPowerWordFortitude
                        : buff.key === 'mark_of_the_wild'
                          ? raidBuffMarkOfTheWild
                          : buff.key === 'battle_shout'
                            ? raidBuffBattleShout
                            : buff.key === 'hunters_mark'
                              ? raidBuffHuntersMark
                              : buff.key === 'bleeding'
                                ? raidBuffBleeding
                                : buff.key === 'mystic_touch'
                                  ? externalBuffMysticTouch
                                  : buff.key === 'chaos_brand'
                                    ? externalBuffChaosBrand
                                    : buff.key === 'skyfury'
                                      ? externalBuffSkyfury
                                      : buff.key === 'power_infusion'
                                        ? externalBuffPowerInfusion
                                        : false;

                const setChecked =
                  buff.key === 'bloodlust'
                    ? setRaidBuffBloodlust
                    : buff.key === 'arcane_intellect'
                      ? setRaidBuffArcaneIntellect
                      : buff.key === 'power_word_fortitude'
                        ? setRaidBuffPowerWordFortitude
                        : buff.key === 'mark_of_the_wild'
                          ? setRaidBuffMarkOfTheWild
                          : buff.key === 'battle_shout'
                            ? setRaidBuffBattleShout
                            : buff.key === 'hunters_mark'
                              ? setRaidBuffHuntersMark
                              : buff.key === 'bleeding'
                                ? setRaidBuffBleeding
                                : buff.key === 'mystic_touch'
                                  ? setExternalBuffMysticTouch
                                  : buff.key === 'chaos_brand'
                                    ? setExternalBuffChaosBrand
                                    : buff.key === 'skyfury'
                                      ? setExternalBuffSkyfury
                                      : buff.key === 'power_infusion'
                                        ? setExternalBuffPowerInfusion
                                        : (_: boolean) => {};

                return (
                  <label
                    key={buff.key}
                    className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 transition-colors ${
                      checked
                        ? 'border-gold/40 bg-gold/[0.08]'
                        : 'border-border bg-surface hover:border-zinc-600'
                    }`}
                  >
                    <a
                      href={`https://www.wowhead.com/spell=${buff.spellId}`}
                      target="_blank"
                      rel="noreferrer"
                      data-wowhead={`spell=${buff.spellId}`}
                      className="flex min-w-0 items-center gap-2 text-zinc-300 hover:text-zinc-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span
                        className="h-4 w-4 shrink-0 rounded-[3px] bg-cover bg-center"
                        style={{
                          backgroundImage: `url(https://wow.zamimg.com/images/wow/icons/small/${buff.icon}.jpg)`,
                        }}
                      />
                      <span className="truncate text-xs">{buff.label}</span>
                    </a>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setChecked(e.target.checked)}
                      className="h-4 w-4 accent-gold"
                    />
                  </label>
                );
              })}
            </div>
            <p className="text-[11px] text-zinc-500">
              If your character provides one of these buffs, SimC may still include it.
            </p>
          </div>

          {/* Expert Mode */}
          <ExpertToggle
            hasContent={hasExpertContent}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            expertValues={expertValues}
            expertSetters={expertSetters}
            activeTabInfo={activeTabInfo}
          />
        </div>
      )}
    </div>
  );
}

function ExpertToggle({
  hasContent,
  activeTab,
  setActiveTab,
  expertValues,
  expertSetters,
  activeTabInfo,
}: {
  hasContent: boolean;
  activeTab: ExpertTabKey;
  setActiveTab: (v: ExpertTabKey) => void;
  expertValues: Record<ExpertTabKey, string>;
  expertSetters: Record<ExpertTabKey, (v: string) => void>;
  activeTabInfo: (typeof EXPERT_TABS)[number];
}) {
  const [open, setOpen] = useState(hasContent);

  return (
    <div className="space-y-3 border-t border-border/60 pt-3">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-2.5">
        <div
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
            open ? 'bg-gold' : 'border border-border bg-surface-2'
          }`}
        >
          <div
            className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
              open ? 'left-[18px] bg-black' : 'left-0.5 bg-gray-500'
            }`}
          />
        </div>
        <span className="text-sm font-medium text-zinc-300">Expert Mode</span>
        {!open && hasContent && (
          <span className="rounded-md bg-gold/10 px-1.5 py-0.5 text-[12px] font-medium text-gold">
            Modified
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-3">
          <div className="flex gap-1 overflow-x-auto">
            {EXPERT_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
                  activeTab === tab.key
                    ? 'border-gold/40 bg-gold/[0.08] text-gold'
                    : expertValues[tab.key].trim()
                      ? 'border-gold/30 bg-gold/[0.06] text-gold hover:border-gold/50'
                      : 'border-border bg-surface-2 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
                }`}
              >
                {tab.label}
                {expertValues[tab.key].trim() && activeTab !== tab.key && (
                  <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-gold" />
                )}
              </button>
            ))}
          </div>
          <textarea
            value={expertValues[activeTab]}
            onChange={(e) => expertSetters[activeTab](e.target.value)}
            placeholder={`Paste ${activeTabInfo.label.toLowerCase()} SimC input here...`}
            className="input-field h-32 resize-y font-mono text-xs"
          />
          <p className="text-[13px] text-zinc-600">{activeTabInfo.desc}</p>
        </div>
      )}
    </div>
  );
}

export default function SimSharedConfig() {
  const pathname = usePathname();
  const { simcInput, setSimcInput, autoClipboardPasteSimc } = useSimContext();
  const checksumStatus = useMemo(() => validateChecksum(simcInput), [simcInput]);
  const detectedInfo = parseCharacterInfo(simcInput);
  const [banner, setBanner] = useState<{ text: string; id: number } | null>(null);
  const bannerTimerRef = useRef<number | null>(null);

  const normalizedPath =
    pathname.endsWith('/') && pathname !== '/' ? pathname.slice(0, -1) : pathname;

  const showConfig =
    normalizedPath === '/quick-sim' ||
    normalizedPath === '/top-gear' ||
    normalizedPath === '/drop-finder' ||
    normalizedPath === '/stat-weights' ||
    normalizedPath === '/upgrade-compare';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!autoClipboardPasteSimc) return;

    let cancelled = false;
    let lastAppliedClipboard = '';

    const readClipboardIntoSimc = async () => {
      if (!document.hasFocus()) return;
      if (!navigator.clipboard?.readText) return;

      try {
        const clipboardText = await navigator.clipboard.readText();
        if (cancelled || !clipboardText) return;
        if (clipboardText === lastAppliedClipboard) return;
        if (clipboardText === simcInput) return;
        if (!looksLikeSimcInput(clipboardText)) return;

        lastAppliedClipboard = clipboardText;
        setSimcInput(clipboardText);
        const firstLine = clipboardText.split(/\r?\n/).find((line) => line.trim())?.trim() || '';
        setBanner({ text: firstLine ? `Detected and pasted: ${firstLine}` : 'Detected and pasted SimC export.', id: Date.now() });
      } catch {
        // Ignore clipboard permission or platform errors.
      }
    };

    const onFocus = () => {
      void readClipboardIntoSimc();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void readClipboardIntoSimc();
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [autoClipboardPasteSimc, setSimcInput, simcInput]);

  useEffect(() => {
    if (!banner) return;
    if (bannerTimerRef.current != null) {
      window.clearTimeout(bannerTimerRef.current);
    }
    bannerTimerRef.current = window.setTimeout(() => {
      setBanner(null);
      bannerTimerRef.current = null;
    }, 3500);
    return () => {
      if (bannerTimerRef.current != null) {
        window.clearTimeout(bannerTimerRef.current);
        bannerTimerRef.current = null;
      }
    };
  }, [banner]);

  if (!showConfig) return null;

  return (
    <div className="mb-6 space-y-4">
      {banner && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[90]">
          <ClipboardBanner message={banner.text} onDismiss={() => setBanner(null)} />
        </div>
      )}
      <div className="card space-y-3 p-5">
        <label className="label-text">SimC Addon Export</label>
        <SimcInputEditor
          value={simcInput}
          onChange={setSimcInput}
          placeholder="Paste your SimC addon export here..."
        />
        {checksumStatus === 'invalid' && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <svg
              className="h-4 w-4 shrink-0 text-amber-400"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M8 1L1 14h14L8 1zM8 6v4M8 12v.5" />
            </svg>
            <p className="text-[14px] text-amber-300">
              This input appears to have been manually edited. Results may not reflect your actual
              in-game character.
            </p>
          </div>
        )}
        {detectedInfo && <CharacterInfoBar info={detectedInfo} />}
      </div>
      <TalentPicker />
      <AdvancedOptions />
    </div>
  );
}
