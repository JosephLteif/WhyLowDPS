import pako from 'pako';
import { PullInfo, SimcClipboardInfo } from './simc-parser';

/**
 * MDT dungeonIndex mapping. 
 */
const MDT_DUNGEON_MAP: Record<number, string> = {
  1: "The Necrotic Wake", 2: "Plaguefall", 3: "Mists of Tirna Scithe", 4: "Halls of Atonement",
  5: "Theater of Pain", 6: "De Other Side", 7: "Spires of Ascension", 8: "Sanguine Depths",
  27: "Tazavesh: Streets of Wonder", 28: "Tazavesh: So'leah's Gambit",
  15: "Freehold", 16: "Waycrest Manor", 17: "Tol Dagor", 18: "The Motherlode!!",
  19: "Shrine of the Storm", 20: "Siege of Boralus", 21: "Temple of Sethraliss",
  22: "The Underrot", 23: "Kings' Rest", 24: "Atal'Dazar",
  25: "Operation: Mechagon - Junkyard", 26: "Operation: Mechagon - Workshop",
  29: "Algeth'ar Academy", 30: "Brackenhide Hollow", 31: "Halls of Infusion",
  32: "Neltharus", 33: "The Azure Vault", 34: "The Nokhud Offensive",
  35: "Uldaman: Legacy of Tyr", 37: "Ara-Kara, City of Echoes",
  38: "City of Threads", 39: "The Dawnbreaker", 40: "The Stonevault",
  41: "Mists of Tirna Scithe (TWW)", 42: "The Necrotic Wake (TWW)",
  43: "Siege of Boralus (TWW)", 44: "Grim Batol",
};

const MDT_CHARSET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789()";

function decodeMdtBase64(input: string): Uint8Array {
  const output: number[] = [];
  let bitfield = 0;
  let bitfieldLen = 0;

  for (let i = 0; i < input.length; i++) {
    const index = MDT_CHARSET.indexOf(input[i]);
    if (index === -1) continue;

    bitfield |= (index << bitfieldLen);
    bitfieldLen += 6;

    while (bitfieldLen >= 8) {
      output.push(bitfield & 0xFF);
      bitfield >>>= 8;
      bitfieldLen -= 8;
    }
  }
  return new Uint8Array(output);
}

class AceSerializer {
  private tokens: string[];
  private tokenIdx: number = 0;
  private static readonly END_TABLE = Symbol('END_TABLE');
  private static readonly UNKNOWN = Symbol('UNKNOWN');

  constructor(data: string) {
    this.tokens = data.split('^');
    if (this.tokens[0] === '') this.tokenIdx = 1;
  }

  public deserialize(): any {
    if (this.tokenIdx >= this.tokens.length) return null;
    
    let token = this.tokens[this.tokenIdx++];
    if (token === 't') return AceSerializer.END_TABLE;
    if (token === '') return null;
    
    const type = token[0];
    let value = token.substring(1);
    
    // Skip version numbers
    if (this.tokenIdx <= 2 && !isNaN(parseInt(type, 10)) && value === "") {
      return this.deserialize();
    }

    switch (type) {
      case 'S':
        while (value.endsWith('~') && this.tokenIdx < this.tokens.length) {
          value += '^' + this.tokens[this.tokenIdx++];
        }
        return value.replace(/~./g, (m) => {
          if (m === '~~') return '~';
          if (m === '~^') return '^';
          return m;
        });
      case 'N':
        return parseFloat(value);
      case 'B':
      case 'b':
        return true;
      case 'F':
      case 'f':
        return false;
      case 'T':
        return this.readTable();
      case 'Z':
        return null;
      default:
        return AceSerializer.UNKNOWN;
    }
  }

  private readTable(): any {
    const table: any = {};

    while (true) {
      const key = this.deserialize();
      if (key === AceSerializer.END_TABLE || this.tokenIdx > this.tokens.length || key === null) break;
      if (key === AceSerializer.UNKNOWN) continue;
      
      const val = this.deserialize();
      if (val === AceSerializer.END_TABLE) break;
      
      if (val !== AceSerializer.UNKNOWN) {
        table[key] = val;
      }
    }

    return table;
  }
}

export function isMdtString(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.startsWith('!') && (trimmed.includes('(', 5) || trimmed.includes(')', 5));
}

export function parseMdtString(input: string): SimcClipboardInfo | null {
  try {
    const trimmed = input.trim();
    let dataPart = trimmed;
    
    if (dataPart.startsWith('!')) {
      const parts = dataPart.split('!');
      dataPart = parts.length >= 3 ? parts[2] : parts[1];
    }
    
    const decoded = decodeMdtBase64(dataPart);
    let decompressedBytes: Uint8Array;
    try {
      decompressedBytes = pako.inflate(decoded);
    } catch (e) {
      decompressedBytes = pako.inflateRaw(decoded);
    }

    const decompressed = new TextDecoder().decode(decompressedBytes);
    const serializer = new AceSerializer(decompressed);
    let data = serializer.deserialize();
    
    if (!data) return null;

    if (!data.pulls && !data.pulle && data.value && typeof data.value === 'object') {
        data = { ...data, ...data.value };
    }

    const dungeonIndex = data.dungeonIndex || 0;
    const dungeonName = MDT_DUNGEON_MAP[dungeonIndex] || `MDT Dungeon ${dungeonIndex}`;
    const level = data.difficulty ? String(data.difficulty) : null;
    const pulls: PullInfo[] = [];

    // Table indices in Lua are 1-based strings when parsed into JS objects by my AceSerializer
    const rawPulls = data.pulls || data.pulle || {};
    
    // Sort keys to ensure pulls are in order
    const pullKeys = Object.keys(rawPulls).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    pullKeys.forEach((key) => {
      const pullData = rawPulls[key];
      if (!pullData || typeof pullData !== 'object') return;
      
      const enemies: { name: string; count: number }[] = [];
      
      Object.entries(pullData).forEach(([eKey, val]) => {
        const enemyIdx = parseInt(eKey, 10);
        // MDT enemy keys are numeric. Values are counts.
        if (!isNaN(enemyIdx) && typeof val === 'number') {
          enemies.push({
            name: `MDT Enemy ${enemyIdx}`,
            count: val
          });
        }
      });

      if (enemies.length > 0) {
        pulls.push({
          pull: key.padStart(2, '0'),
          name: pullData.note || `Pull ${key}`,
          bloodlust: !!(pullData.bl || pullData.bloodlust),
          progress: null,
          enemies,
        });
      }
    });

    return {
      kind: 'dungeon',
      title: `${dungeonName} (MDT Route)`,
      dungeon: dungeonName,
      level,
      maxTime: null,
      pullCount: pulls.length,
      pulls,
      extras: [
        'Imported from MDT String',
        data.week ? `MDT Week ${data.week}` : null,
        data.affix ? `Affix Set ${data.affix}` : null
      ].filter((v): v is string => !!v),
    };
  } catch (err) {
    console.error('[MDT] Error during parsing:', err);
    return null;
  }
}

export function convertMdtToSimc(info: SimcClipboardInfo): string {
  if (info.kind !== 'dungeon') return '';
  let output = `fight_style=DungeonRoute\nenemy="${info.title}"\n`;
  if (info.dungeon) output += `dungeon="${info.dungeon}"\n`;
  if (info.level) output += `keystone_level=${info.level}\n`;
  
  info.pulls.forEach((pull, idx) => {
    const bl = pull.bloodlust ? '1' : '0';
    const enemies = pull.enemies.map(e => `"${e.name}":${e.count}`).join('|');
    output += `raid_events+=/pull,pull=${pull.pull || String(idx+1).padStart(2, '0')},bloodlust=${bl},enemies=${enemies}\n`;
  });
  return output;
}
