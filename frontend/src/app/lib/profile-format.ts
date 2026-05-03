import { CLASS_COLORS } from './types';

function normalizeClassKey(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/g, '_');
}

export function resolveClassColor(className?: string | null): string | undefined {
  if (!className) return undefined;
  const normalized = normalizeClassKey(className);
  return CLASS_COLORS[normalized] || CLASS_COLORS[normalized.replace(/_/g, '')];
}

export function formatRealmName(realm?: string | null): string {
  if (!realm) return '';
  return realm.charAt(0).toUpperCase() + realm.slice(1);
}
