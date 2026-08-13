import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { wowExpansions, wowSeasons } from '../../lib/wow-season-content';

interface Instance {
  id: number;
  name: string;
  type: string;
  expansion?: number;
  expansion_name?: string;
}

interface AddItemInstanceSidebarProps {
  instances: Instance[];
  selectedInstance: number;
  onSelect: (id: number) => void;
  currentSeasonName?: string | null;
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

export default function AddItemInstanceSidebar({
  instances,
  selectedInstance,
  onSelect,
  currentSeasonName,
}: AddItemInstanceSidebarProps) {
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
  const currentExpansionId = catalogCurrentExpansionId ?? latestExpansionId;
  const currentExpansionKey = catalogCurrentExpansionId
    ? `expansion-${catalogCurrentExpansionId}`
    : currentExpansionName
      ? 'current-expansion'
      : `expansion-${latestExpansionId}`;
  const currentSeasonDisplay = currentSeasonLabel
    ? seasonLabelForExpansion(currentSeasonLabel, currentExpansionName || undefined)
    : null;
  const currentSeasonKey = currentSeasonDisplay
    ? `${currentExpansionKey}-season-${seasonKey(currentSeasonDisplay)}`
    : null;

  const groupedInstances = useMemo<ExpansionGroup[]>(() => {
    if (hasOnlyCraftedFilters) return [];

    const groups = new Map<string, ExpansionGroup>();
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

    return [...groups.values()]
      .map((group) => ({
        ...group,
        seasons: [...group.seasons].sort((left, right) => left.order - right.order),
      }))
      .sort((left, right) => left.order - right.order);
  }, [
    currentExpansionId,
    currentExpansionKey,
    currentExpansionName,
    currentSeasonLabel,
    expansionNames,
    hasOnlyCraftedFilters,
    instances,
    seasonDefinitions,
  ]);

  const defaultCollapsedGroups = useMemo(() => {
    const collapsed = new Set<string>();
    for (const group of groupedInstances) {
      if (group.key !== 'season-filters' && group.key !== currentExpansionKey) {
        collapsed.add(group.key);
      }
      for (const season of group.seasons) {
        if (season.key !== currentSeasonKey) collapsed.add(season.key);
      }
    }
    return collapsed;
  }, [currentExpansionKey, currentSeasonKey, groupedInstances]);
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

  const renderInstance = (instance: Instance) => {
    const isActive = selectedInstance === instance.id;
    const isMeta = instance.id < 0 && instance.type !== 'search';
    return (
      <button
        key={instance.id}
        onClick={() => onSelect(instance.id)}
        className={`group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all duration-150 ${
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
          {instance.name}
        </span>
      </button>
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
        {!isCollapsed && <div className="space-y-0.5">{season.instances.map(renderInstance)}</div>}
      </div>
    );
  };

  const renderExpansionGroup = (group: ExpansionGroup) => {
    const isCollapsed = collapsedGroups.has(group.key);
    return (
      <section key={group.key}>
        <button
          type="button"
          onClick={() => toggleGroup(group.key)}
          className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-500 transition-colors hover:bg-white/[0.03] hover:text-zinc-300"
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
                {group.ungroupedInstances.map(renderInstance)}
              </div>
            )}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="scrollbar-thin scrollbar-thumb-white/10 w-52 shrink-0 space-y-0.5 overflow-y-auto border-r border-border bg-surface/50 p-1.5">
      {hasOnlyCraftedFilters
        ? instances.map(renderInstance)
        : groupedInstances.map(renderExpansionGroup)}
      {instances.length === 0 && (
        <div className="p-6 text-center text-xs italic text-zinc-600">No instances found</div>
      )}
    </div>
  );
}
