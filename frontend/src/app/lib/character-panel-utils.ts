import { characterHref } from './routes';
import type { CharacterRunMember, MythicPlusPayload, MythicRun } from './character-domain-types';

const MYTHIC_VAULT_THRESHOLDS = [1, 4, 8] as const;

function isRunLike(value: unknown): value is MythicRun {
  return (
    value != null &&
    typeof value === 'object' &&
    (typeof (value as MythicRun).keystone_level === 'number' ||
      typeof (value as MythicRun).keystoneLevel === 'number' ||
      !!(value as MythicRun).keystone_dungeon ||
      !!(value as MythicRun).dungeon ||
      !!(value as MythicRun).completed_challenge_mode)
  );
}

function collectRuns(root: unknown): MythicRun[] {
  const out: MythicRun[] = [];
  const stack: unknown[] = [root];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      if (current.some((item) => isRunLike(item))) out.push(...current.filter((item) => isRunLike(item)));
      else for (const item of current) if (item && typeof item === 'object') stack.push(item);
      continue;
    }
    if (typeof current === 'object') {
      if (isRunLike(current)) out.push(current);
      for (const value of Object.values(current as Record<string, unknown>)) {
        if (value && typeof value === 'object') stack.push(value);
      }
    }
  }
  return out;
}

function getRunLevel(run: MythicRun): number {
  return Number(run?.keystone_level ?? run?.keystoneLevel ?? 0);
}

function getRunTimestamp(run: MythicRun): number {
  return Number(
    run?.completed_timestamp ??
      run?.completedTimestamp ??
      run?.end_timestamp ??
      run?.endTimestamp ??
      run?.start_timestamp ??
      run?.startTimestamp ??
      run?.timestamp ??
      0
  );
}

export function normalizeRealmSlug(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/\s+/g, '-')
    .trim();
}

export function getWeeklyResetStartMs(regionRaw: string | null | undefined, now = new Date()): number {
  const region = String(regionRaw || 'us').toLowerCase();
  const resetDayUtc = region === 'eu' ? 3 : region === 'asia' ? 4 : 2;
  const resetHourUtc = region === 'eu' ? 4 : region === 'us' ? 15 : 7;
  const current = new Date(now);
  const todayReset = new Date(
    Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate(), resetHourUtc, 0, 0, 0)
  );
  const dayDiff = (current.getUTCDay() - resetDayUtc + 7) % 7;
  const reset = new Date(todayReset);
  reset.setUTCDate(reset.getUTCDate() - dayDiff);
  if (current.getUTCDay() === resetDayUtc && current.getUTCHours() < resetHourUtc) {
    reset.setUTCDate(reset.getUTCDate() - 7);
  }
  return reset.getTime();
}

export function computeMythicVaultProgress(
  mythicPlus: MythicPlusPayload,
  region?: string
): {
  runsForVault: number;
  slotThresholds: number[];
  slots: Array<{ slot: number; threshold: number; unlocked: boolean; remaining: number; progress: number }>;
} {
  if (!mythicPlus || typeof mythicPlus !== 'object') {
    const thresholds = [...MYTHIC_VAULT_THRESHOLDS];
    return {
      runsForVault: 0,
      slotThresholds: thresholds,
      slots: thresholds.map((threshold, idx) => ({
        slot: idx + 1,
        threshold,
        unlocked: false,
        remaining: threshold,
        progress: 0,
      })),
    };
  }

  const allRuns = collectRuns(mythicPlus).filter((run) => getRunLevel(run) > 0);
  const recentSource = Array.isArray(mythicPlus?.recent_runs) ? mythicPlus.recent_runs : allRuns;
  const recentRuns = [...recentSource].sort((a, b) => getRunTimestamp(b) - getRunTimestamp(a)).slice(0, 20);
  const weekStart = getWeeklyResetStartMs(region);
  const recentWeekCount = recentRuns.filter((run) => {
    const ts = getRunTimestamp(run);
    const tsMs = ts > 0 && ts < 1_000_000_000_000 ? ts * 1000 : ts;
    return tsMs > 0 && tsMs >= weekStart;
  }).length;
  const currentPeriodCount = collectRuns(mythicPlus?.current_period || {}).filter((run) => {
    const ts = getRunTimestamp(run);
    const tsMs = ts > 0 && ts < 1_000_000_000_000 ? ts * 1000 : ts;
    return tsMs > 0 && tsMs >= weekStart;
  }).length;
  const runsForVault = Math.max(recentWeekCount, currentPeriodCount);

  const slotThresholds = [...MYTHIC_VAULT_THRESHOLDS];
  const slots = slotThresholds.map((threshold, idx) => ({
    slot: idx + 1,
    threshold,
    unlocked: runsForVault >= threshold,
    remaining: Math.max(0, threshold - runsForVault),
    progress: Math.min(1, runsForVault / threshold),
  }));

  return { runsForVault, slotThresholds, slots };
}

export function isCurrentExpansionPlaceholder(value: unknown): boolean {
  const lower = String(value ?? '').trim().toLowerCase();
  return lower === 'current season' || lower === 'current expansion';
}

export function isLikelyCurrentExpansionLabel(value: unknown): boolean {
  const lower = String(value ?? '').trim().toLowerCase();
  if (!lower) return false;
  return (
    lower === 'midnight' ||
    lower.startsWith('the war within') ||
    lower.startsWith('11.') ||
    lower.startsWith('12.')
  );
}

function normalizeCharacterName(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeRegionCode(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function tryDecodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function getMemberProfileHref(
  member: CharacterRunMember | null | undefined,
  fallbackRegion?: string
): { href: string; external: boolean } | null {
  if (!member) return null;
  const memberName =
    member?.linked_name ||
    member?.profile?.name ||
    member?.character?.name ||
    member?.character_name ||
    member?.name ||
    '';
  const memberRegion =
    member?.linked_region ||
    member?.profile?.region ||
    member?.character?.region ||
    member?.region ||
    member?.profile?.realm?.region ||
    fallbackRegion;
  const rawRealm =
    member?.linked_realm ||
    member?.profile?.realm?.slug ||
    member?.profile?.realm?.name ||
    member?.character?.realm?.slug ||
    member?.character?.realm?.name ||
    member?.realm;
  const memberRegionCode = normalizeRegionCode(memberRegion);
  const memberNameSlug = normalizeCharacterName(memberName);
  const realmSlug = normalizeRealmSlug(rawRealm);

  if (memberNameSlug && memberRegionCode && realmSlug) {
    return {
      href: characterHref(memberRegionCode, realmSlug, memberNameSlug),
      external: false,
    };
  }

  const externalUrl = member?.linked_profile_url || member?.profile?.url || member?.character?.url || member?.url;
  if (typeof externalUrl === 'string' && externalUrl.startsWith('http')) {
    const match = externalUrl.match(/\/character\/([^/]+)\/([^/]+)\/([^/?#]+)/i);
    if (match) {
      const parsedRegion = normalizeRegionCode(tryDecodeSegment(String(match[1] || '')));
      const parsedRealm = normalizeRealmSlug(tryDecodeSegment(String(match[2] || '')));
      const parsedName = normalizeCharacterName(tryDecodeSegment(String(match[3] || '')));
      if (parsedRegion && parsedRealm && parsedName) {
        return {
          href: characterHref(parsedRegion, parsedRealm, parsedName),
          external: false,
        };
      }
    }
  }

  if (typeof externalUrl === 'string' && externalUrl.startsWith('http')) {
    return { href: externalUrl, external: true };
  }
  return null;
}

export type ParsedVaultRewardItem = {
  slot: string;
  itemId: string;
  ilevel: string;
  bonusIds: number[];
};

export function parseVaultRewardsFromSimcInput(latestSimcInput: string | null | undefined): ParsedVaultRewardItem[] {
  const input = String(latestSimcInput || '');
  if (!input.trim()) return [];

  const lines = input.split(/\r?\n/);
  const blocks: string[][] = [];
  let currentBlock: string[] | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const lower = line.toLowerCase();
    if (lower.includes('weekly reward choices') && !lower.includes('end of weekly reward choices')) {
      currentBlock = [];
      blocks.push(currentBlock);
      continue;
    }
    if (lower.includes('end of weekly reward choices')) {
      currentBlock = null;
      continue;
    }
    if (currentBlock) currentBlock.push(line);
  }

  const parseItemLines = (itemLines: string[]): ParsedVaultRewardItem[] => {
    const parsed: ParsedVaultRewardItem[] = [];
    const seen = new Set<string>();
    for (const line of itemLines) {
      const body = line.replace(/^#\s*/, '').trim();
      const match = body.match(/^([a-z0-9_]+)\s*=\s*(.+)$/i);
      if (!match) continue;
      const slot = match[1].trim();
      const simc = match[2].trim();
      const idMatch = simc.match(/id=(\d+)/i);
      if (!idMatch) continue;
      const ilevelMatch = simc.match(/ilevel=(\d+)/i);
      const bonusMatch = simc.match(/bonus_id=([0-9/]+)/i);
      const bonusIds = bonusMatch
        ? bonusMatch[1]
            .split('/')
            .map((v) => Number(v))
            .filter((v) => Number.isFinite(v) && v > 0)
        : [];
      const item = { slot, itemId: idMatch[1], ilevel: ilevelMatch?.[1] || '-', bonusIds };
      const key = `${item.slot}|${item.itemId}|${item.ilevel}|${item.bonusIds.join('/')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parsed.push(item);
    }
    return parsed;
  };

  if (blocks.length > 0) {
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const parsed = parseItemLines(blocks[i]);
      if (parsed.length > 0) return parsed;
    }
    return [];
  }

  return [];
}
