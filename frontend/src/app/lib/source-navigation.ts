import type { Instance } from '../drop-finder/types';

export interface SourceNavigationItem {
  source_type?: string;
  instance_name?: string;
  instance_id?: number;
  encounter?: string;
}

export interface SourceTagLink {
  text: string;
  path: string;
}

export function normalizeSourceName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isRaidSource(item: SourceNavigationItem): boolean {
  return String(item.source_type || '')
    .toLowerCase()
    .includes('raid');
}

export function sourceListPath(item: SourceNavigationItem): string {
  return isRaidSource(item) ? '/raids' : '/dungeons';
}

export function findSourceInstance(
  item: SourceNavigationItem,
  instances: Instance[]
): Instance | null {
  const instanceId = Number(item.instance_id || 0);
  if (instanceId > 0) {
    const byId = instances.find((instance) => Number(instance.id) === instanceId);
    if (byId) return byId;
  }

  const instanceName = normalizeSourceName(item.instance_name || '');
  if (instanceName) {
    const byName = instances.find(
      (instance) => normalizeSourceName(instance.name) === instanceName
    );
    if (byName) return byName;
  }

  const encounterName = normalizeSourceName(item.encounter || '');
  if (!encounterName) return null;
  return (
    instances.find((instance) =>
      (instance.encounters || []).some(
        (encounter) => normalizeSourceName(encounter.name) === encounterName
      )
    ) || null
  );
}

export function sourceDetailsPath(item: SourceNavigationItem, instances: Instance[]): string {
  const instance = findSourceInstance(item, instances);
  if (!instance) return sourceListPath(item);
  const basePath = isRaidSource(item) ? '/raids/details' : '/dungeons/details';
  return `${basePath}/?id=${encodeURIComponent(String(instance.id))}`;
}

export function buildSourceTagLinks(
  item: SourceNavigationItem,
  instances: Instance[]
): SourceTagLink[] {
  const normalizeTagText = (raw: string): string => {
    const text = String(raw || '').trim();
    if (!text.includes('->') && !text.includes('â†’')) return text;
    const segments = text
      .split(/\s*(?:->|â†’)\s*/g)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    if (segments.length < 3) return text;
    const from = segments[segments.length - 2];
    const to = segments[segments.length - 1];
    return `${from} -> ${to}`;
  };

  const isSyntheticTag = (raw: string): boolean => {
    const text = String(raw || '').trim().toLowerCase();
    if (!text) return true;
    if (/^mod:\d+$/.test(text)) return true;
    if (/^i?l?v?l[:\s]*\d+$/.test(text)) return true;
    if (text === 'ascendant_voidcore' || text === 'ascendant voidcore') return true;
    return false;
  };

  const detailsPath = sourceDetailsPath(item, instances);
  const listPath = sourceListPath(item);
  const tags = [
    { text: item.instance_name || '', path: detailsPath },
    { text: item.source_type || '', path: listPath },
    { text: item.encounter || '', path: detailsPath },
  ]
    .map((tag) => ({ ...tag, text: normalizeTagText(tag.text) }))
    .filter((tag) => tag.text.trim().length > 0 && !isSyntheticTag(tag.text));

  const seen = new Set<string>();
  return tags.filter((tag) => {
    const key = normalizeSourceName(tag.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
