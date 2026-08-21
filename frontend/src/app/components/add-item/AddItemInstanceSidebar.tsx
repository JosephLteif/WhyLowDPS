import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { wowExpansions, wowInstances, wowSeasons } from '../../lib/wow-season-content';

const SIDEBAR_DEFAULT_WIDTH = 208;
const SIDEBAR_MIN_WIDTH = 184;
const SIDEBAR_MAX_WIDTH = 380;

interface Instance {
  id: number;
  name: string;
  type: string;
  expansion?: number;
  expansion_name?: string;
  encounters?: Array<{ id: number; name: string }>;
  active_rotation?: boolean;
}

interface AddItemInstanceSidebarProps {
  instances: Instance[];
  selectedInstance: number;
  onSelect: (id: number) => void;
  onSelectExpansion?: (id: number, expansionId: number) => void;
  focusedExpansionId?: number | null;
  currentSeasonName?: string | null;
  isDungeonBrowser?: boolean;
}

interface SeasonGroup {
  key: string;
  label: string;
  order: number;
  instances: Instance[];
}

interface ExpansionGroup {
  key: string;
  label: string;
  order: number;
  instances: Instance[];
  seasons: SeasonGroup[];
  ungroupedInstances: Instance[];
}

interface SeasonDefinition {
  expansionId: number;
  label: string;
  order: number;
}

const catalogExpansionByInstanceId = new Map(
  wowInstances.map((instance) => [instance.id, instance.expansionId])
);

function isActiveDungeonBucket(instance: Instance): boolean {
  return instance.type === 'mplus-chest' && instance.id < 0;
}

function displayInstanceName(instance: Instance): string {
  return isActiveDungeonBucket(instance) ? 'All Active Dungeons' : instance.name;
}

function currentSeasonLabelFromName(seasonName: string | null | undefined): string | null {
  const normalized = seasonName?.trim();
  const parenthesized = normalized?.match(/\(([^()]+?)\s+Season\s+(\d+)\)\s*$/i);
  if (parenthesized) return `${parenthesized[1]} Season ${parenthesized[2]}`;

  const seasonMatch = normalized?.match(/^(?:Mythic\+\s+)?(.+?)\s+Season\s+(\d+)\s*$/i);
  if (seasonMatch) return `${seasonMatch[1]} Season ${seasonMatch[2]}`;

  return normalized || null;
}

function expansionNameFromSeason(seasonName: string | null | undefined): string | null {
  const seasonLabel = currentSeasonLabelFromName(seasonName);
  if (!seasonLabel || /^(?:current\s+)?season(?:\s+\d+)?$/i.test(seasonLabel)) return null;
  return seasonLabel.replace(/\s+Season\s+\d+\s*$/i, '').trim() || null;
}

function seasonLabelForExpansion(seasonName: string, expansionName: string | undefined): string {
  const normalizedSeason = seasonName.trim();
  if (expansionName && normalizedSeason.toLowerCase().startsWith(`${expansionName.toLowerCase()} `)) {
    return normalizedSeason.slice(expansionName.length).trim();
  }
  return normalizedSeason.match(/Season\s+\d+/i)?.[0] || normalizedSeason;
}

function seasonKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

export default function AddItemInstanceSidebar({
  instances,
  selectedInstance,
  onSelect,
  onSelectExpansion,
  focusedExpansionId = null,
  currentSeasonName,
  isDungeonBrowser = false,
}: AddItemInstanceSidebarProps) {
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStart = useRef<{ clientX: number; width: number } | null>(null);
  const hasOnlyCraftedFilters =
    instances.length > 0 && instances.every((inst) => inst.type === 'crafted-slot');

  const expansionNames = useMemo(
    () => new Map(wowExpansions.map((expansion) => [expansion.id, expansion.name])),
    []
  );
  const latestExpansionId = useMemo(
    () => Math.max(...wowExpansions.map((expansion) => expansion.id), 0),
    []
  );
  const seasonDefinitions = useMemo(() => {
    const byInstanceId = new Map<number, SeasonDefinition>();
    for (const [order, season] of wowSeasons.entries()) {
      for (const instanceId of season.raidInstanceIds) {
        if (!byInstanceId.has(instanceId)) {
          byInstanceId.set(instanceId, {
            expansionId: season.expansionId,
            label: season.name,
            order,
          });
        }
      }
    }
    return byInstanceId;
  }, []);
  const currentSeasonLabel = currentSeasonLabelFromName(currentSeasonName);
  const currentExpansionName = expansionNameFromSeason(currentSeasonName);
  const catalogCurrentExpansionId = wowExpansions.find(
    (expansion) => expansion.name.toLowerCase() === currentExpansionName?.toLowerCase()
  )?.id;
  const currentExpansionId =
    catalogCurrentExpansionId ??
    (Number(instances.find((instance) => instance.id >= 0 && instance.expansion)?.expansion) ||
      latestExpansionId);
  const currentExpansionKey = catalogCurrentExpansionId
    ? `expansion-${catalogCurrentExpansionId}`
      : `expansion-${currentExpansionId}`;
  const activeDungeonIds = useMemo(() => {
    const activeBucket = instances.find(isActiveDungeonBucket);
    return new Set(activeBucket?.encounters?.map((encounter) => encounter.id) || []);
  }, [instances]);
  const selectedExpansionId =
    selectedInstance >= 0
      ? (() => {
          const selected = instances.find((instance) => instance.id === selectedInstance);
          const parsed = Number(selected?.expansion);
          return Number.isFinite(parsed) && parsed > 0
            ? parsed
            : catalogExpansionByInstanceId.get(selectedInstance) || null;
        })()
      : null;
  const selectedExpansionKey = selectedExpansionId
    ? `expansion-${selectedExpansionId}`
    : currentExpansionKey;
  const selectedIsActiveDungeon =
    isDungeonBrowser &&
    (instances.find((instance) => instance.id === selectedInstance)?.type === 'mplus-chest' ||
      activeDungeonIds.has(selectedInstance));
  const selectedGroupKey =
    focusedExpansionId != null
      ? `expansion-${focusedExpansionId}`
      : selectedIsActiveDungeon
      ? 'active-dungeons'
      : selectedExpansionKey;
  const currentSeasonDisplay = currentSeasonLabel
    ? seasonLabelForExpansion(currentSeasonLabel, currentExpansionName || undefined)
    : null;
  const currentSeasonKey = currentSeasonDisplay
    ? `${currentExpansionKey}-season-${seasonKey(currentSeasonDisplay)}`
    : null;

  const groupedInstances = useMemo<ExpansionGroup[]>(() => {
    if (hasOnlyCraftedFilters) return [];

    const groups = new Map<string, ExpansionGroup>();

    if (isDungeonBrowser) {
      const activeBucket = instances.find(isActiveDungeonBucket);
      const activeIds = new Set(activeBucket?.encounters?.map((encounter) => encounter.id) || []);
      const activeDungeons = instances.filter(
        (instance) => instance.type === 'dungeon' && activeIds.has(instance.id)
      );

      if (activeBucket && activeDungeons.length > 0) {
        groups.set('active-dungeons', {
          key: 'active-dungeons',
          label: 'Active Dungeons',
          order: -2_000_000,
          instances: [activeBucket, ...activeDungeons],
          seasons: [],
          ungroupedInstances: [activeBucket, ...activeDungeons],
        });
      }

      for (const instance of instances) {
        if (instance.id < 0 || instance.type !== 'dungeon') continue;

        const parsedExpansionId = Number(instance.expansion);
        const expansionId =
          Number.isFinite(parsedExpansionId) && expansionNames.has(parsedExpansionId)
            ? parsedExpansionId
            : catalogExpansionByInstanceId.get(instance.id) || currentExpansionId;
        const expansionLabel = expansionNames.get(expansionId) || 'Current content';
        const key = `expansion-${expansionId}`;
        const group = groups.get(key) || {
          key,
          label: expansionLabel,
          order: -expansionId,
          instances: [],
          seasons: [],
          ungroupedInstances: [],
        };
        group.instances.push(instance);
        group.ungroupedInstances.push(instance);
        groups.set(key, group);
      }

      return [...groups.values()].sort((left, right) => left.order - right.order);
    }

    const seasonFilterInstances: Instance[] = [];

    const getGroup = (expansionId: number, label: string) => {
      const key = expansionId > 0 ? `expansion-${expansionId}` : currentExpansionKey;
      const existing = groups.get(key);
      if (existing) return existing;

      const group: ExpansionGroup = {
        key,
        label,
        order: key === currentExpansionKey ? -1_000_000 : -expansionId,
        instances: [],
        seasons: [],
        ungroupedInstances: [],
      };
      groups.set(key, group);
      return group;
    };

    for (const instance of instances) {
      const isMeta = instance.id < 0 && instance.type !== 'search';
      if (isMeta) {
        seasonFilterInstances.push(instance);
        continue;
      }
      const knownSeason = seasonDefinitions.get(instance.id);
      const parsedExpansionId = Number(instance.expansion);
      const catalogExpansionId =
        Number.isFinite(parsedExpansionId) && expansionNames.has(parsedExpansionId)
          ? parsedExpansionId
          : null;
      const expansionId = knownSeason?.expansionId ?? catalogExpansionId ?? currentExpansionId;
      const expansionLabel =
        expansionNames.get(expansionId) ||
        instance.expansion_name?.trim() ||
        currentExpansionName ||
        'Current content';
      const group = getGroup(expansionId, expansionLabel);
      group.instances.push(instance);
      const seasonName =
        knownSeason?.label ||
        (expansionId === currentExpansionId ? currentSeasonLabel : null);
      if (!seasonName) {
        group.ungroupedInstances.push(instance);
        continue;
      }

      const label = seasonLabelForExpansion(seasonName, expansionLabel);
      const key = `${group.key}-season-${seasonKey(label)}`;
      const season = group.seasons.find((candidate) => candidate.key === key);
      if (season) {
        season.instances.push(instance);
      } else {
        group.seasons.push({
          key,
          label,
          order: knownSeason?.order ?? -1,
          instances: [instance],
        });
      }
    }

    if (seasonFilterInstances.length > 0) {
      groups.set('season-filters', {
        key: 'season-filters',
        label: 'Season filters',
        order: -2_000_000,
        instances: seasonFilterInstances,
        seasons: [],
        ungroupedInstances: seasonFilterInstances,
      });
    }

    return [...groups.values()].sort((left, right) => left.order - right.order);
  }, [
    currentExpansionId,
    currentExpansionName,
    currentExpansionKey,
    currentSeasonLabel,
    expansionNames,
    hasOnlyCraftedFilters,
    instances,
    isDungeonBrowser,
    seasonDefinitions,
  ]);

  const defaultCollapsedGroups = useMemo(() => {
    const collapsed = new Set<string>();
    for (const group of groupedInstances) {
      if (group.key !== selectedGroupKey) {
        collapsed.add(group.key);
      }
      for (const season of group.seasons) {
        if (season.key !== currentSeasonKey) collapsed.add(season.key);
      }
    }
    return collapsed;
  }, [currentSeasonKey, groupedInstances, selectedGroupKey]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(defaultCollapsedGroups);

  useEffect(() => {
    setCollapsedGroups(defaultCollapsedGroups);
  }, [defaultCollapsedGroups]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStart.current = { clientX: event.clientX, width: sidebarWidth };
    setIsResizing(true);
  };

  const handleResizePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!resizeStart.current) return;
    setSidebarWidth(
      clampSidebarWidth(resizeStart.current.width + event.clientX - resizeStart.current.clientX)
    );
  };

  const handleResizePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resizeStart.current = null;
    setIsResizing(false);
  };

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 40 : 16;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      setSidebarWidth((current) =>
        clampSidebarWidth(current + (event.key === 'ArrowRight' ? step : -step))
      );
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setSidebarWidth(event.key === 'Home' ? SIDEBAR_MIN_WIDTH : SIDEBAR_MAX_WIDTH);
    }
  };

  const renderInstance = (instance: Instance, showExpansionLink = false) => {
    const isActive = selectedInstance === instance.id;
    const isMeta = instance.id < 0 && instance.type !== 'search';
    const parsedExpansionId = Number(instance.expansion);
    const expansionId =
      Number.isFinite(parsedExpansionId) && parsedExpansionId > 0 && expansionNames.has(parsedExpansionId)
        ? parsedExpansionId
        : catalogExpansionByInstanceId.get(instance.id);
    const instanceButton = (
      <button
        key={instance.id}
        onClick={() => onSelect(instance.id)}
        className={`group flex min-w-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all duration-150 ${
          showExpansionLink ? 'flex-1' : 'w-full'
        } ${
          isActive
            ? 'border border-gold/20 bg-gold/[0.08] text-gold shadow-sm'
            : 'border border-transparent text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200'
        }`}
      >
        <div
          className={`h-1.5 w-1.5 shrink-0 rounded-full transition-transform group-hover:scale-125 ${
            isMeta
              ? 'bg-gold shadow-[0_0_6px_rgba(212,168,67,0.4)]'
              : instance.type === 'raid'
                ? 'bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.3)]'
                : instance.type.includes('pvp')
                  ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.3)]'
                  : 'bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.3)]'
          }`}
        />
        <span
          className={`truncate text-xs leading-tight ${isMeta ? 'font-bold' : 'font-semibold'}`}
        >
          {displayInstanceName(instance)}
        </span>
      </button>
    );

    if (!showExpansionLink || expansionId == null || onSelectExpansion == null) {
      return instanceButton;
    }

    return (
      <div key={instance.id} className="flex min-w-0 items-center gap-1">
        {instanceButton}
        <button
          type="button"
          onClick={() => onSelectExpansion(instance.id, expansionId)}
          className="max-w-[6.5rem] shrink-0 truncate rounded px-1.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-zinc-600 transition-colors hover:bg-gold/[0.08] hover:text-gold"
          title={`Show ${expansionNames.get(expansionId) || 'source expansion'}`}
        >
          {expansionNames.get(expansionId) || 'Expansion'}
        </button>
      </div>
    );
  };

  const renderSeasonGroup = (season: SeasonGroup) => {
    const isCollapsed = collapsedGroups.has(season.key);
    return (
      <div key={season.key} className="space-y-0.5">
        <button
          type="button"
          onClick={() => toggleGroup(season.key)}
          className="flex w-full items-center justify-between rounded-md px-3 py-1.5 pl-5 text-left text-[10px] font-semibold uppercase tracking-wide text-zinc-500 transition-colors hover:bg-white/[0.03] hover:text-zinc-300"
          aria-expanded={!isCollapsed}
        >
          <span className="truncate">{season.label}</span>
          <span className="ml-2 flex shrink-0 items-center gap-1.5 text-[9px] text-zinc-600">
            {season.instances.length}
            <ChevronDown
              className={`h-3 w-3 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
            />
          </span>
        </button>
        {!isCollapsed && (
          <div className="space-y-0.5">{season.instances.map((instance) => renderInstance(instance))}</div>
        )}
      </div>
    );
  };

  const renderExpansionGroup = (group: ExpansionGroup) => {
    const isCollapsed = collapsedGroups.has(group.key);
    const isSelected = group.key === selectedGroupKey;
    return (
      <section key={group.key}>
        <button
          type="button"
          onClick={() => toggleGroup(group.key)}
          className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-[10px] font-bold uppercase tracking-wider transition-colors hover:bg-white/[0.03] hover:text-zinc-300 ${
            isSelected ? 'bg-gold/[0.08] text-gold' : 'text-zinc-500'
          }`}
          aria-expanded={!isCollapsed}
        >
          <span className="truncate">{group.label}</span>
          <span className="ml-2 flex shrink-0 items-center gap-1.5 text-[9px] text-zinc-600">
            {group.instances.length}
            <ChevronDown
              className={`h-3 w-3 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
            />
          </span>
        </button>
        {!isCollapsed && (
          <div className="space-y-1">
            {group.seasons.map(renderSeasonGroup)}
            {group.ungroupedInstances.length > 0 && (
              <div className="space-y-0.5">
                {group.seasons.length > 0 && (
                  <div className="px-3 py-1.5 pl-5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
                    Other content
                  </div>
                )}
                {group.ungroupedInstances.map((instance) =>
                  renderInstance(instance, group.key === 'active-dungeons' && instance.type === 'dungeon')
                )}
              </div>
            )}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="relative h-auto w-full shrink-0 sm:h-full sm:w-auto">
      <div className="border-b border-border bg-surface/50 p-2 sm:hidden">
        <label className="label-text mb-1">Loot source</label>
        <select
          value={instances.some((instance) => instance.id === selectedInstance) ? selectedInstance : ''}
          onChange={(event) => onSelect(Number(event.target.value))}
          className="input-field h-10"
          aria-label="Loot source"
          disabled={instances.length === 0}
        >
          {instances.length === 0 ? (
            <option value="">No instances found</option>
          ) : (
            instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {displayInstanceName(instance)}
              </option>
            ))
          )}
        </select>
      </div>

      <div className="hidden h-full sm:block" style={{ width: sidebarWidth }}>
        <div className="scrollbar-thin scrollbar-thumb-white/10 h-full w-full min-w-0 space-y-0.5 overflow-y-auto border-r border-border bg-surface/50 p-1.5">
          {hasOnlyCraftedFilters
            ? instances.map((instance) => renderInstance(instance))
            : groupedInstances.map(renderExpansionGroup)}
          {instances.length === 0 && (
            <div className="p-6 text-center text-xs italic text-zinc-600">No instances found</div>
          )}
        </div>
        <div
          role="separator"
          aria-label="Resize instance panel"
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onKeyDown={handleResizeKeyDown}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerUp}
          className={`absolute right-[-5px] top-0 z-20 flex h-full w-2 cursor-col-resize touch-none select-none items-center justify-center outline-none ${
            isResizing ? 'bg-gold/10' : 'hover:bg-gold/5 focus-visible:bg-gold/10'
          }`}
        >
          <span
            className={`h-10 w-0.5 rounded-full transition-colors ${
              isResizing ? 'bg-gold' : 'bg-border hover:bg-gold/70'
            }`}
          />
        </div>
      </div>
    </div>
  );
}
