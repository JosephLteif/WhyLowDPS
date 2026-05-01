import { decodeHeader, type NodeSelection } from './talentDecode';
import { encodeTalentString, normalizeTalentString } from './talentEncode';
import type { TalentTreeData } from './useTalentTree';
import type { CharacterSpecialization, CharacterTalentLoadout } from './character-domain-types';

const TALENT_EXPORT_RE = /^[A-Za-z0-9+/]+$/;

export function isTalentExportString(value: string, expectedSpecId?: number | null): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 16 || !TALENT_EXPORT_RE.test(trimmed)) return false;
  try {
    const header = decodeHeader(trimmed);
    if (header.bits.length <= header.offset) return false;
    if (header.specId <= 0) return false;
    return !(expectedSpecId && header.specId !== expectedSpecId);
  } catch {
    return false;
  }
}

function findTalentExportString(input: unknown, expectedSpecId?: number | null): string | null {
  if (!input || typeof input !== 'object') return null;
  const seen = new Set<unknown>();
  const stack: unknown[] = [input];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    if (typeof current === 'string') {
      if (isTalentExportString(current, expectedSpecId)) return current.trim();
      continue;
    }

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    if (typeof current === 'object') {
      for (const value of Object.values(current as Record<string, unknown>)) {
        if (typeof value === 'string') {
          if (isTalentExportString(value, expectedSpecId)) return value.trim();
        } else if (value && typeof value === 'object') {
          stack.push(value);
        }
      }
    }
  }

  return null;
}

export function buildCharacterTalentString({
  tree,
  specId,
  activeLoadout,
  activeSpec,
}: {
  tree: TalentTreeData | null;
  specId: number | null;
  activeLoadout: CharacterTalentLoadout | null;
  activeSpec: CharacterSpecialization | null;
}): string | null {
  if (!tree || !specId) return null;

  try {
    const directCandidates = [
      activeLoadout?.talent_loadout_code,
      activeLoadout?.talentLoadoutCode,
      activeLoadout?.loadout_code,
      activeLoadout?.code,
      activeSpec?.talent_loadout_code,
      activeSpec?.talentLoadoutCode,
    ].filter((v): v is string => typeof v === 'string');
    const direct = directCandidates.find((v) => isTalentExportString(v, specId));
    if (direct) return normalizeTalentString(direct, tree);

    const discovered =
      findTalentExportString(activeLoadout, specId) ?? findTalentExportString(activeSpec, specId);
    if (discovered) return normalizeTalentString(discovered, tree);

    const selections = new Map<number, NodeSelection>();
    const selectedTalents = [
      ...(activeLoadout?.selected_class_talents || []),
      ...(activeLoadout?.selected_spec_talents || []),
      ...(activeLoadout?.selected_hero_talents || []),
    ];
    const talents = [...selectedTalents, ...(activeSpec?.talents || [])];
    const allNodes = [...tree.classNodes, ...tree.specNodes, ...tree.heroNodes];

    for (const talent of talents) {
      const candidateIds = [
        talent.id,
        talent.talent?.id,
        talent.tooltip_spell?.id,
        talent.spell_tooltip?.spell?.id,
        talent.selected_tooltip?.spell?.id,
      ].filter((id): id is number => typeof id === 'number' && Number.isFinite(id));
      if (candidateIds.length === 0) continue;

      const node = allNodes.find((n) =>
        candidateIds.some((id) => n.id === id || n.entries.some((e) => e.id === id || e.spellId === id))
      );
      if (!node) continue;

      const choiceIndex = node.entries.findIndex((entry) =>
        candidateIds.some((id) => entry.id === id || entry.spellId === id)
      );
      const existing = selections.get(node.id);
      const nextRanks = Math.max(existing?.ranks ?? 0, talent.rank ?? node.maxRanks ?? 1);
      const nextChoice = choiceIndex >= 0 ? choiceIndex : (existing?.choiceIndex ?? -1);
      selections.set(node.id, {
        ranks: nextRanks,
        choiceIndex: nextChoice,
      });
    }

    if (selections.size === 0) return null;
    return normalizeTalentString(encodeTalentString(selections, tree, specId), tree);
  } catch (error) {
    console.warn('Failed to encode talent string:', error);
    return null;
  }
}
