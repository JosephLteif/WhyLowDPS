import { slotFromInventoryType, slotLabelToSimSlot } from '../lib/gear-utils';
import type { SeasonConfigResponse } from '../lib/types';
import type { DropItem, TrackLevel, UpgradeTracks } from './types';

export const TRACK_SHORT: Record<string, string> = {
  Adventurer: 'Adv',
  Veteran: 'Vet',
  Champion: 'Champ',
  Hero: 'Hero',
  Myth: 'Myth',
};

export function getRaidDifficultyDisplayLevel(key: string): number {
  return key ? 1 : 0;
}

export function getTrackLevels(trackName: string, tracks: UpgradeTracks): TrackLevel[] | null {
  if (!trackName) return null;
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  const normalizedTrack = normalize(trackName);
  const matchedKey = Object.keys(tracks).find((key) => normalize(key) === normalizedTrack);
  return matchedKey ? tracks[matchedKey] : null;
}

export function getTrackMaxLevel(trackName: string, tracks: UpgradeTracks): number {
  const levels = getTrackLevels(trackName, tracks);
  if (!levels || levels.length === 0) return 0;
  return levels.reduce((max, level) => Math.max(max, level.max_level || 0), 0);
}

export function getDroptimizerCandidateSlots(slotLabel: string, inventoryType?: number): string[] {
  const normalizedExplicit = slotLabelToSimSlot(slotLabel);
  if (normalizedExplicit) return [normalizedExplicit];

  if (inventoryType === 11) return ['finger1', 'finger2'];
  if (inventoryType === 12) return ['trinket1', 'trinket2'];
  const mapped = slotFromInventoryType(inventoryType);
  return mapped ? [mapped] : [];
}

export function coerceDropsResponse(input: unknown): Record<string, DropItem[]> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;

  const normalized: Record<string, DropItem[]> = {};
  for (const [slot, rawItems] of Object.entries(input as Record<string, unknown>)) {
    if (!Array.isArray(rawItems)) continue;

    const items: DropItem[] = [];
    for (const raw of rawItems) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as DropItem;
      if (!Number.isFinite(item.item_id)) continue;
      items.push(item);
    }

    if (items.length > 0) normalized[slot] = items;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

export function parseInstanceSelectionIds(selection: string): string[] {
  if (!selection) return [];
  if (!selection.startsWith('ids:')) return [selection];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of selection.slice(4).split(',')) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

export function encodeInstanceSelectionIds(ids: string[]): string {
  const seen = new Set<string>();
  const unique = ids
    .map((id) => id.trim())
    .filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => Number(a) - Number(b));

  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0];
  return `ids:${unique.join(',')}`;
}

export const FALLBACK_SEASON_CONFIG: SeasonConfigResponse = {
  season: '',
  raid_difficulties: [
    { key: 'lfr', label: 'Raid Finder', track: 'Veteran', level: 1, sortOrder: 1 },
    { key: 'normal', label: 'Normal', track: 'Champion', level: 2, sortOrder: 2 },
    { key: 'heroic', label: 'Heroic', track: 'Hero', level: 3, sortOrder: 3 },
    { key: 'mythic', label: 'Mythic', track: 'Myth', level: 4, sortOrder: 4 },
  ],
  dungeon_categories: [
    {
      key: 'mplus',
      label: 'Mythic+',
      poolInstanceId: -1,
      defaultDifficulty: 'mythic+10',
      difficulties: [
        { key: 'heroic', label: 'Heroic', track: 'Adventurer', level: 2, sortOrder: 1 },
        { key: 'mythic', label: 'Mythic 0', track: 'Champion', level: 1, sortOrder: 2 },
        { key: 'mythic+2', label: '+2', track: 'Champion', level: 2, sortOrder: 3 },
        { key: 'mythic+3', label: '+3', track: 'Champion', level: 2, sortOrder: 4 },
        { key: 'mythic+4', label: '+4', track: 'Champion', level: 3, sortOrder: 5 },
        { key: 'mythic+5', label: '+5', track: 'Champion', level: 4, sortOrder: 6 },
        { key: 'mythic+6', label: '+6', track: 'Champion', level: 5, sortOrder: 7 },
        { key: 'mythic+7', label: '+7', track: 'Hero', level: 1, sortOrder: 8 },
        { key: 'mythic+8', label: '+8', track: 'Hero', level: 2, sortOrder: 9 },
        { key: 'mythic+9', label: '+9', track: 'Hero', level: 2, sortOrder: 10 },
        { key: 'mythic+10', label: '+10', track: 'Hero', level: 3, sortOrder: 11 },
        { key: 'vault+7-9', label: 'Vault +7-9', track: 'Hero', level: 4, sortOrder: 12 },
        { key: 'vault+10', label: 'Vault +10', track: 'Myth', level: 1, sortOrder: 13 },
      ],
    },
    {
      key: 'normal-dungeons',
      label: 'Dungeons',
      poolInstanceId: -32,
      defaultDifficulty: 'heroic',
      difficulties: [
        {
          key: 'normal',
          label: 'Normal',
          track: null,
          level: 0,
          sortOrder: 1,
          fixedIlvl: 214,
          fixedQuality: 3,
        },
        { key: 'heroic', label: 'Heroic', track: 'Adventurer', level: 2, sortOrder: 2 },
        { key: 'mythic', label: 'Mythic', track: 'Champion', level: 1, sortOrder: 3 },
      ],
    },
  ],
};
