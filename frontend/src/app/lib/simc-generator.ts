
export interface BlizzardItem {
  slot: { type: string };
  item: { id: number };
  level: { value: number };
  binding?: { type: string };
  quality?: { type: string };
  name: string;
  media?: { id: number };
  bonus_list?: number[];
  enchantments?: Array<{
    enchantment_id: number;
    display_string?: string;
  }>;
  sockets?: Array<{
    item?: { id: number; name: string };
    display_string?: string;
  }>;
}

const SLOT_MAPPING: Record<string, string> = {
  HEAD: 'head',
  NECK: 'neck',
  SHOULDER: 'shoulder',
  BACK: 'back',
  CHEST: 'chest',
  WRIST: 'wrist',
  HANDS: 'hands',
  WAIST: 'waist',
  LEGS: 'legs',
  FEET: 'feet',
  FINGER_1: 'finger1',
  FINGER_2: 'finger2',
  TRINKET_1: 'trinket1',
  TRINKET_2: 'trinket2',
  MAIN_HAND: 'main_hand',
  OFF_HAND: 'off_hand',
  TABARD: 'tabard',
  SHIRT: 'shirt',
};

export function generateSimcString(
  character: any,
  equipment: any,
  talents?: string | null,
  specName?: string | null
): string {
  const lines: string[] = [];
  
  const name = character.name || 'Unknown';
  const realm = character.realm?.name || character.realm?.slug || character.realm || 'Unknown';
  const region = character.region?.name || character.region || 'us';
  const playerClassRaw = character.character_class?.name || character.class || 'Warrior';
  const playerClass = playerClassRaw.toLowerCase().replace(/\s+/g, '_');
  const race = character.race?.name?.toLowerCase().replace(/\s+/g, '_') || 
               character.race?.toLowerCase().replace(/\s+/g, '_') || 'human';
  const level = character.level?.value || character.level || 80;
  const dateStr = new Date().toISOString().split('T')[0];

  // Header comments (official addon style)
  lines.push(`# ${name} - ${specName || 'Unknown Spec'} - ${dateStr} - ${region.toUpperCase()}/${realm}`);
  lines.push(`# WhyLowDps v1.0.0 (Blizzard API Data Mode)`);
  lines.push(``);

  lines.push(`${playerClass}="${name}"`);
  lines.push(`level=${level}`);
  lines.push(`race=${race.replace(/\s+/g, '_')}`);
  lines.push(`region=${region.toString().toLowerCase()}`);
  lines.push(`server=${realm.toString().toLowerCase().replace(/\s+/g, '_')}`);
  
  // Professions
  if (character.professions?.primaries) {
    const profs = character.professions.primaries
      .map((p: any) => `${p.profession.name.toLowerCase().replace(/\s+/g, '_')}=${p.skill_points}`)
      .join('/');
    if (profs) {
      lines.push(`professions=${profs}`);
    }
  }

  // Role detection
  const casters = ['warlock', 'mage', 'priest', 'druid', 'shaman']; // Simple caster check
  const isCaster = casters.includes(playerClass);
  lines.push(`role=${isCaster ? 'spell' : 'damager'}`);
  
  if (specName) {
    lines.push(`spec=${specName.toLowerCase().replace(/\s+/g, '_')}`);
  }
  
  if (talents) {
    lines.push(`talents=${talents}`);
  }

  // Pre-combat actions for accurate sims (best-in-slot TWW consumables)
  lines.push(``);
  lines.push(`# Consumables`);
  lines.push(`actions.precombat+=/flask=temptation_of_the_broken_shore_3`);
  lines.push(`actions.precombat+=/food=feast_of_the_midnight_masquerade`);
  lines.push(`actions.precombat+=/potion=tempted_fate_3`);
  lines.push(`actions.precombat+=/augmentation=crystallized_augmentation`);
  
  lines.push(``);

  const items = equipment.equipped_items || [];
  for (const item of items) {
    const simcSlot = SLOT_MAPPING[item.slot.type];
    if (!simcSlot) continue;

    // Item comment: # Item Name (Item Level)
    lines.push(`# ${item.name} (${item.level?.value || '???'})`);

    // Standard SimC format: slot=,id=...,bonus_id=...,enchant_id=...,gem_id=...
    let itemLine = `${simcSlot}=,id=${item.item.id}`;
    
    if (item.level?.value) {
        itemLine += `,ilevel=${item.level.value}`;
    }

    if (item.bonus_list && item.bonus_list.length > 0) {
      itemLine += `,bonus_id=${item.bonus_list.join('/')}`;
    }

    if (item.enchantments) {
      for (const enchant of item.enchantments) {
        if (enchant.enchantment_id) {
          itemLine += `,enchant_id=${enchant.enchantment_id}`;
        }
      }
    }

    if (item.sockets) {
      const gemIds = item.sockets
        .map((s: any) => s.item?.id)
        .filter(Boolean);
      if (gemIds.length > 0) {
        itemLine += `,gem_id=${gemIds.join('/')}`;
      }
    }

    lines.push(itemLine);
  }

  return lines.join('\n');
}
