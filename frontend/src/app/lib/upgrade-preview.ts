export interface UpgradePreviewLabelArgs {
  upgradeLabel: string;
  equippedUpgradeLabel?: string | null;
  equippedTierLevelLabel?: string | null;
  itemTierLevelLabel?: string | null;
  itemIlevel?: number;
  equippedIlevel?: number;
  upgradeLevels?: number;
  sourceType?: string | null;
}

export interface UpgradeTierLevel {
  tier: string;
  level: number;
  max: number;
}

export function normalizeUpgradeLabel(value?: string | null): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function labelsEqual(left?: string | null, right?: string | null): boolean {
  return (
    String(left || '')
      .trim()
      .toLowerCase() ===
    String(right || '')
      .trim()
      .toLowerCase()
  );
}

function collapseUpgradeLabelPath(
  upgradeLabel: string,
  equippedUpgradeLabel?: string | null,
  equippedTierLevelLabel?: string | null,
  itemIlevel = 0,
  equippedIlevel = 0
): string {
  const segments = upgradeLabel
    .split('->')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const target = segments[segments.length - 1] || '';
  const equipped = normalizeUpgradeLabel(equippedUpgradeLabel);
  const equippedTier = normalizeUpgradeLabel(equippedTierLevelLabel);

  if (!target && !equipped) return '';
  if (segments.length > 1) {
    const current = [equippedTier, equipped.split('->')[0]?.trim() || ''].find((candidate) =>
      segments.some((segment) => labelsEqual(segment, candidate))
    );
    if (current) {
      const currentIndex = segments.findIndex((segment) => labelsEqual(segment, current));
      const next = segments.slice(currentIndex === 0 ? 1 : 0).pop();
      if (next && !labelsEqual(current, next)) return `${current} -> ${next}`;
    }

    const from = parseUpgradeTierLevel(segments[0]);
    const to = parseUpgradeTierLevel(segments[segments.length - 1]);
    const shouldReverse =
      from &&
      to &&
      ((itemIlevel > equippedIlevel && from.level > to.level) ||
        (itemIlevel < equippedIlevel && from.level < to.level));
    if (shouldReverse) return `${segments[segments.length - 1]} -> ${segments[0]}`;
  }

  if (!equipped) {
    if (segments.length > 1) {
      const previous = segments[segments.length - 2] || '';
      return labelsEqual(previous, target) ? target : `${previous} -> ${target}`;
    }
    return target;
  }
  if (!target) return equipped;
  return labelsEqual(equipped, target) ? target : `${equipped} -> ${target}`;
}

export function parseUpgradeTierLevel(upgradeRaw?: string): UpgradeTierLevel | null {
  const value =
    String(upgradeRaw || '')
      .split(/\s*->\s*/)
      .pop()
      ?.trim() || '';
  const match = value.match(/^([A-Za-z]+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  return {
    tier: match[1],
    level: Number(match[2]),
    max: Number(match[3]),
  };
}

export function formatUpgradePreviewLabel({
  upgradeLabel,
  equippedUpgradeLabel,
  equippedTierLevelLabel,
  itemTierLevelLabel,
  itemIlevel = 0,
  equippedIlevel = 0,
  upgradeLevels = 0,
  sourceType,
}: UpgradePreviewLabelArgs): string {
  const collapsed = collapseUpgradeLabelPath(
    upgradeLabel,
    equippedUpgradeLabel,
    equippedTierLevelLabel,
    itemIlevel,
    equippedIlevel
  );
  const collapsedTarget =
    collapsed
      .split(/\s*->\s*/)
      .pop()
      ?.trim() || '';
  const normalizedCollapsedTarget = normalizeUpgradeLabel(collapsedTarget);
  const normalizedEquippedTier = normalizeUpgradeLabel(equippedTierLevelLabel);
  const normalizedItemTier = normalizeUpgradeLabel(itemTierLevelLabel);

  if (!collapsed.includes('->') && normalizedCollapsedTarget) {
    if (normalizedEquippedTier && !labelsEqual(normalizedEquippedTier, normalizedCollapsedTarget)) {
      return `${normalizedEquippedTier} -> ${normalizedCollapsedTarget}`;
    }
    if (normalizedItemTier && !labelsEqual(normalizedItemTier, normalizedCollapsedTarget)) {
      return `${normalizedItemTier} -> ${normalizedCollapsedTarget}`;
    }
  }
  if (collapsed.includes('->')) return collapsed;

  const target = parseUpgradeTierLevel(collapsed);
  if (!target) return collapsed;

  const levels = Number(upgradeLevels || 0);
  if (levels > 0 && target.level > levels) {
    return `${target.tier} ${target.level - levels}/${target.max} -> ${target.tier} ${target.level}/${target.max}`;
  }

  if (equippedIlevel <= 0 || itemIlevel <= 0 || equippedIlevel === itemIlevel) return collapsed;

  const ascendantDelta = /(?:^|\s)mod:268552(?:\s|$)|ascendant_voidcore/i.test(
    String(sourceType || '')
  )
    ? 9
    : 0;
  const targetBaseIlevel = Math.max(equippedIlevel, itemIlevel - ascendantDelta);
  const ilevelDelta = targetBaseIlevel - equippedIlevel;
  const inferredLevelDelta = Math.min(target.level - 1, Math.max(1, Math.round(ilevelDelta / 3.5)));
  const previousLevel = target.level - inferredLevelDelta;

  return previousLevel > 0 && previousLevel !== target.level
    ? `${target.tier} ${previousLevel}/${target.max} -> ${target.tier} ${target.level}/${target.max}`
    : collapsed;
}
