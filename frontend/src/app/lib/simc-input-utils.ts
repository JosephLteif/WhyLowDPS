/** Adler-32 checksum matching the SimC addon's implementation.
 * The Lua addon processes raw UTF-8 bytes, so we must do the same. */
function adler32(input: string): number {
  const prime = 65521;
  let s1 = 1;
  let s2 = 0;
  const bytes = new TextEncoder().encode(input);
  for (let i = 0; i < bytes.length; i++) {
    s1 = (s1 + bytes[i]) % prime;
    s2 = (s2 + s1) % prime;
  }
  return ((s2 << 16) | s1) >>> 0;
}

/** Validate the SimC addon checksum. Returns null if valid or no checksum present. */
export function validateChecksum(input: string): 'valid' | 'invalid' | null {
  const match = input.match(/^#\s*Checksum:\s*([0-9a-fA-F]+)\s*$/m);
  if (!match) return null;
  const expected = parseInt(match[1], 16);
  const idx = input.indexOf(match[0]);
  const body = input.substring(0, idx);
  if (adler32(body) === expected) return 'valid';
  if (adler32(body.replace(/\n/g, '\r\n')) === expected) return 'valid';
  return 'invalid';
}

function looksLikeSimcInput(input: string): boolean {
  const text = input.trim();
  if (text.length < 10) return false;

  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const hasChecksum = lines.some((line) => /^#\s*Checksum:/i.test(line));
  const hasSimcKeyValue = lines.some((line) =>
    /^(?:warrior|paladin|hunter|rogue|priest|death_knight|deathknight|shaman|mage|warlock|monk|druid|demon_hunter|demonhunter|evoker|player|name|server|region|spec|talents)\s*=/i.test(
      line
    )
  );
  const hasArmoryLine = lines.some((line) => /^armory\s*=/i.test(line));
  const hasCharacterHeader = lines.some((line) => /^\w+="[^"]+"/.test(line));
  const hasDungeonRoute = lines.some((line) =>
    /^(?:dungeon_route|route|mythic_plus_route|mplus_route|dungeon|instance|keystone_level|mythic_plus_level)\s*=/i.test(
      line
    )
  );

  return hasChecksum || hasArmoryLine || hasSimcKeyValue || hasCharacterHeader || hasDungeonRoute;
}

export function splitSimcProfiles(input: string): string[] {
  const profiles: string[] = [];
  const lines = input.split(/\r?\n/);
  let currentProfile: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    currentProfile.push(line);

    if (/^#\s*Checksum:\s*[0-9a-fA-F]+/i.test(line.trim())) {
      profiles.push(currentProfile.join('\n'));
      currentProfile = [];
    }
  }

  if (currentProfile.some((line) => line.trim().length > 0)) {
    profiles.push(currentProfile.join('\n'));
  }

  return profiles.map((profile) => profile.trim()).filter((profile) => looksLikeSimcInput(profile));
}

export function normalizeClipboardTextPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object' && 'text' in payload) {
    const text = (payload as { text?: unknown }).text;
    return typeof text === 'string' ? text : '';
  }
  return '';
}
