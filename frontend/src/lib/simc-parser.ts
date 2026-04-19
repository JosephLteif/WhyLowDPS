export type PullInfo = {
  pull: string | null;
  name: string | null;
  bloodlust: boolean;
  progress: string | null;
  delay: number | null;
  totalHealth: number | null;
  enemies: { name: string; count: number; health?: number; id?: number }[];
};

export type SimcClipboardInfo =
  | {
      kind: 'character';
      className: string;
      name: string;
      spec: string;
      level: string | null;
      race: string | null;
      region: string | null;
      server: string | null;
      role: string | null;
      professions: string | null;
      lootSpec: string | null;
      addonVersion: string | null;
      wowVersion: string | null;
      requiresVersion: string | null;
      talentsCount: number;
      savedLoadouts: number;
      checksum: string | null;
    }
  | {
      kind: 'dungeon';
      title: string;
      dungeon: string | null;
      level: string | null;
      maxTime: string | null;
      pullCount: number | null;
      pulls: PullInfo[];
      extras: string[];
    };

export function parseCharacterInfo(input: string): SimcClipboardInfo | null {
  if (!input) return null;

  const nameMatch = input.match(/^(\w+)="(.+)"$/m);
  const specMatch = input.match(/^spec=(\w+)/m);
  const characterLevelMatch = input.match(/^level=(.+)$/m);
  const raceMatch = input.match(/^race=(.+)$/m);
  const classKeyMatch = input.match(
    /^(warrior|paladin|hunter|rogue|priest|death_knight|deathknight|shaman|mage|warlock|monk|druid|demon_hunter|demonhunter|evoker)\s*=\s*"?([^"\n,]+)"?/im
  );
  const realmMatch = input.match(/^server=(.+)$/m);
  const regionMatch = input.match(/^region=(.+)$/m);
  const roleMatch = input.match(/^role=(.+)$/m);
  const professionsMatch = input.match(/^professions=(.+)$/m);
  const lootSpecMatch = input.match(/^#\s*loot_spec=(.+)$/m);
  const addonVersionMatch = input.match(/^#\s*SimC Addon\s+(.+)$/m);
  const wowVersionMatch = input.match(/^#\s*WoW\s+(.+)$/m);
  const requiresVersionMatch = input.match(/^#\s*Requires SimulationCraft\s+(.+)$/m);
  const checksumMatch = input.match(/^#\s*Checksum:\s*([0-9a-fA-F]+)/m);
  const talentsCount = (input.match(/^talents=/gim) || []).length;
  const savedLoadouts = (input.match(/^#\s*Saved Loadout:/gim) || []).length;
  const routeMatch = input.match(
    /^(?:dungeon_route|route|mythic_plus_route|mplus_route)\s*=\s*"?([^"\n]+)"?/im
  );
  const fightStyleMatch = input.match(/^fight_style\s*=\s*"?([^"\n]+)"?/im);
  const enemyMatch = input.match(/^enemy\s*=\s*"([^"]+)"/im);
  const dungeonMatch = input.match(
    /^(?:dungeon|instance|mythic_plus_dungeon|keystone_dungeon)\s*=\s*"?([^"\n,]+)"?/im
  );
  const levelMatch = input.match(
    /^(?:keystone_level|level|mythic_plus_level)\s*=\s*"?([^"\n,]+)"?/im
  );
  const maxTimeMatch = input.match(/^max_time\s*=\s*"?([^"\n,]+)"?/im);
  const affixMatch = input.match(/^(?:affix|affixes)\s*=\s*"?([^"\n,]+)"?/im);
  const seasonMatch = input.match(/^(?:season|dungeon_season)\s*=\s*"?([^"\n,]+)"?/im);
  const titleMatch = input.match(/^#\s*(.+)$/m);
  const dungeonTitleMatch = input.match(/^#\s*(?:dungeon|route|mythic\s*\+)\s*[:\-]\s*(.+)$/im);

  if (nameMatch && classKeyMatch) {
    return {
      kind: 'character',
      className: classKeyMatch[1],
      name: nameMatch[2],
      spec: specMatch?.[1] || 'unknown',
      level: characterLevelMatch?.[1] || null,
      race: raceMatch?.[1] || null,
      region: regionMatch?.[1] || null,
      server: realmMatch?.[1] || null,
      role: roleMatch?.[1] || null,
      professions: professionsMatch?.[1] || null,
      lootSpec: lootSpecMatch?.[1] || null,
      addonVersion: addonVersionMatch?.[1] || null,
      wowVersion: wowVersionMatch?.[1] || null,
      requiresVersion: requiresVersionMatch?.[1] || null,
      talentsCount,
      savedLoadouts,
      checksum: checksumMatch?.[1] || null,
    };
  }

  if (routeMatch || dungeonMatch || input.toLowerCase().includes('dungeon')) {
    const enemyName = enemyMatch?.[1]?.trim() || null;
    const dungeonFromEnemy = enemyName?.match(/^(.+?)\s*-\s*(.+?)\s*\([^)]*\)\s*$/)?.[2] || null;
    const dungeon =
      dungeonMatch?.[1] ||
      dungeonFromEnemy ||
      dungeonTitleMatch?.[1] ||
      titleMatch?.[1] ||
      enemyName;
    const pullLines = input.match(/^raid_events\+=\/pull,.+$/gim) || [];

    const pulls: PullInfo[] = pullLines.map((line) => {
      const pNumMatch = line.match(/pull=([0-9]+)/i);
      const pNameMatch = line.match(/name="?([^"\n,]+)"?/i);
      const blMatch = line.match(/bloodlust=([01])/i);
      const progressMatch = line.match(/progress=([0-9.]+)/i);
      const delayMatch = line.match(/delay=([0-9]+)/i);

      const enemiesMatch = line.match(/enemies=([^,\r\n]+)/i);
      const explicitHealthMatch = line.match(/health=([0-9]+)/i);
      const enemiesList: { name: string; count: number; health?: number; id?: number }[] = [];
      let pullTotalHealth = 0;

      if (enemiesMatch) {
        const rawEnemies = enemiesMatch[1].split('|');
        const counts = new Map<string, { count: number; health: number; id?: number }>();
        for (const raw of rawEnemies) {
          const [nameWithId, valStr] = raw.split(':');
          const val = valStr ? parseInt(valStr, 10) : 1;

          const idMatch = nameWithId.match(/_(\d+)"?$/);
          const npcId = idMatch ? parseInt(idMatch[1], 10) : undefined;

          const name = nameWithId
            .trim()
            .replace(/^"/, '')
            .replace(/"$/, '')
            .replace(/_\d+$/, '')
            .replace(/^BOSS_/i, '')
            .replace(/-/g, ' ')
            .replace(/\b\w/g, (l) => l.toUpperCase())
            .trim();

          // MDT format often uses Name_ID:Count.
          // However, if the value is very large (>1000), it is almost certainly health,
          // even if an NPC ID is present.
          const isHealth = !isNaN(val) && val > 1000;
          const health = isHealth ? val : 0;
          const count = isHealth ? 1 : val > 0 ? val : 1;

          if (name) {
            const entry = counts.get(name) || { count: 0, health: 0, id: npcId };
            entry.count += count;
            entry.health += health;
            counts.set(name, entry);
            pullTotalHealth += health;
          }
        }
        for (const [name, data] of counts) {
          enemiesList.push({
            name,
            count: data.count,
            health: data.health || undefined,
            id: data.id,
          });
        }
      }

      if (explicitHealthMatch && pullTotalHealth === 0) {
        pullTotalHealth = parseInt(explicitHealthMatch[1], 10);
      }

      return {
        pull: pNumMatch?.[1] || null,
        name: pNameMatch?.[1] || null,
        bloodlust: blMatch?.[1] === '1',
        progress: progressMatch?.[1] || null,
        delay: delayMatch ? parseInt(delayMatch[1], 10) : null,
        totalHealth: pullTotalHealth || null,
        enemies: enemiesList,
      };
    });

    const pullCount = pulls.length || null;

    const extras = [
      fightStyleMatch?.[1] ? `fight_style=${fightStyleMatch[1]}` : null,
      levelMatch?.[1] ? `+${levelMatch[1]}` : null,
      maxTimeMatch?.[1] ? `max_time=${maxTimeMatch[1]}` : null,
      pullCount ? `${pullCount} pulls` : null,
      affixMatch?.[1] || null,
      seasonMatch?.[1] || null,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim());
    return {
      kind: 'dungeon',
      title: dungeon || 'Dungeon route',
      dungeon,
      level: levelMatch?.[1] || null,
      maxTime: maxTimeMatch?.[1] || null,
      pullCount,
      pulls,
      extras,
    };
  }

  return null;
}

export type SimcBuff = {
  name: string;
  category: 'flask' | 'food' | 'potion' | 'augment' | 'raid_buff' | 'other';
  value?: string;
  spellId?: number;
  icon?: string;
  itemId?: number;
};

export function parseSimcBuffs(input: string): SimcBuff[] {
  if (!input) return [];
  const buffs: SimcBuff[] = [];

  const lines = input.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') && !trimmed.includes('=')) continue;

    // Remove comments for matching but keep the line if it has an assignment
    const cleanLine = trimmed.replace(/^#\s*/, '');

    const flaskMatch = cleanLine.match(/^flask=([^,\n]+)/i);
    if (flaskMatch) {
      const name = flaskMatch[1].replace(/_/g, ' ');
      buffs.push({ name, category: 'flask' });
    }

    const foodMatch = cleanLine.match(/^food=([^,\n]+)/i);
    if (foodMatch) {
      const name = foodMatch[1].replace(/_/g, ' ');
      buffs.push({ name, category: 'food' });
    }

    const potionMatch = cleanLine.match(/^potion=([^,\n]+)/i);
    if (potionMatch) {
      const name = potionMatch[1].replace(/_/g, ' ');
      buffs.push({ name, category: 'potion' });
    }

    const augmentMatch =
      cleanLine.match(/^augmentation=([^,\n]+)/i) || cleanLine.match(/^augments=([^,\n]+)/i);
    if (augmentMatch) {
      const name = augmentMatch[1].replace(/_/g, ' ');
      buffs.push({ name, category: 'augment' });
    }

    // Common raid buffs in raid_events or direct assignments
    const lowerLine = cleanLine.toLowerCase();
    if (
      lowerLine.includes('bloodlust') ||
      lowerLine.includes('heroism') ||
      lowerLine.includes('time_warp')
    ) {
      buffs.push({ name: 'Bloodlust', category: 'raid_buff', spellId: 2825 });
    }
    if (lowerLine.includes('power_infusion')) {
      buffs.push({ name: 'Power Infusion', category: 'raid_buff', spellId: 10060 });
    }
    if (lowerLine.includes('windfury_totem')) {
      buffs.push({ name: 'Windfury Totem', category: 'raid_buff', spellId: 382440 });
    }
    if (lowerLine.includes('mana_tide_totem')) {
      buffs.push({ name: 'Mana Tide Totem', category: 'raid_buff', spellId: 16191 });
    }
    if (lowerLine.includes('battle_shout')) {
      buffs.push({ name: 'Battle Shout', category: 'raid_buff', spellId: 6673 });
    }
    if (lowerLine.includes('arcane_intellect')) {
      buffs.push({ name: 'Arcane Intellect', category: 'raid_buff', spellId: 1459 });
    }
    if (lowerLine.includes('power_word_fortitude')) {
      buffs.push({ name: 'Power Word: Fortitude', category: 'raid_buff', spellId: 21562 });
    }
    if (lowerLine.includes('mark_of_the_wild')) {
      buffs.push({ name: 'Mark of the Wild', category: 'raid_buff', spellId: 1126 });
    }
    if (lowerLine.includes('mystic_touch')) {
      buffs.push({ name: 'Mystic Touch', category: 'raid_buff', spellId: 8647 });
    }
    if (lowerLine.includes('chaos_brand')) {
      buffs.push({ name: 'Chaos Brand', category: 'raid_buff', spellId: 1490 });
    }
    if (lowerLine.includes('skyfury')) {
      buffs.push({ name: 'Skyfury', category: 'raid_buff', spellId: 462854 });
    }
    if (lowerLine.includes('vampiric_touch')) {
      // usually PI logic or similar
    }
  }

  // Deduplicate
  return buffs.filter(
    (buff, index, self) =>
      index === self.findIndex((b) => b.name === buff.name && b.category === buff.category)
  );
}
