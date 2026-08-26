export type ActiveCharacter = {
  region: string;
  realm: string;
  name: string;
  className?: string;
  spec?: string;
  level?: number;
  ilvl?: number;
};

export const ACTIVE_CHARACTER_STORAGE_KEY = 'whylowdps_active_character_v1';

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

export function characterKey(character: Pick<ActiveCharacter, 'region' | 'realm' | 'name'>): string {
  return [character.region, character.realm, character.name]
    .map((value) => clean(value).toLowerCase())
    .join('|');
}

export function normalizeActiveCharacter(value: unknown): ActiveCharacter | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const region = clean(raw.region);
  const realm = clean(raw.realm || raw.server);
  const name = clean(raw.name);
  if (!region || !realm || !name) return null;

  const level = Number(raw.level);
  const ilvl = Number(raw.ilvl);
  return {
    region,
    realm,
    name,
    ...(clean(raw.className || raw.class_name) && {
      className: clean(raw.className || raw.class_name),
    }),
    ...(clean(raw.spec) && { spec: clean(raw.spec) }),
    ...(Number.isFinite(level) && level > 0 ? { level } : {}),
    ...(Number.isFinite(ilvl) && ilvl > 0 ? { ilvl } : {}),
  };
}

export function parseStoredCharacterKey(value: unknown): ActiveCharacter | null {
  const raw = clean(value);
  if (!raw) return null;
  const separator = raw.includes('|') ? '|' : ':';
  const [region, realm, name] = raw.split(separator).map((part) => part.trim());
  return normalizeActiveCharacter({ region, realm, name });
}

export function readStoredActiveCharacter(storage: Storage | undefined): ActiveCharacter | null {
  if (!storage) return null;
  try {
    const current = storage.getItem(ACTIVE_CHARACTER_STORAGE_KEY);
    if (current) {
      const parsed = normalizeActiveCharacter(JSON.parse(current));
      if (parsed) return parsed;
    }

    const legacyMain = parseStoredCharacterKey(storage.getItem('whylowdps_main_character'));
    if (legacyMain) return legacyMain;

    const legacyDefaults = parseStoredCharacterKey(
      storage.getItem('whylowdps_defaults_last_character_key')
    );
    if (legacyDefaults) return legacyDefaults;

    const tracked = storage.getItem('whylowdps_tracked_characters');
    if (tracked) {
      const parsed = JSON.parse(tracked);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = parseStoredCharacterKey(parsed[0]);
        if (first) return first;
      }
    }
  } catch {
    // Ignore malformed legacy state and let the user choose a character.
  }
  return null;
}

export function writeStoredActiveCharacter(
  storage: Storage | undefined,
  character: ActiveCharacter | null
): void {
  if (!storage) return;
  try {
    if (character) storage.setItem(ACTIVE_CHARACTER_STORAGE_KEY, JSON.stringify(character));
    else storage.removeItem(ACTIVE_CHARACTER_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in privacy-restricted webviews.
  }
}
