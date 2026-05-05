import type { TopGearResult } from './types';

function splitGeneratedInput(input: string): {
  baseActorLines: string[];
  comboSections: Map<string, string[]>;
} {
  const lines = input.split(/\r?\n/);
  const baseActorLines: string[] = [];
  const comboSections = new Map<string, string[]>();

  let inBaseActor = false;
  let currentSection: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line === '# Base Actor') {
      inBaseActor = true;
      currentSection = null;
      continue;
    }

    const comboMatch = /^###\s+(.+?)\s*$/.exec(line.trim());
    if (comboMatch) {
      currentSection = comboMatch[1];
      comboSections.set(currentSection, []);
      continue;
    }

    if (currentSection) {
      comboSections.get(currentSection)?.push(line);
    } else if (inBaseActor) {
      baseActorLines.push(line);
    }
  }

  return { baseActorLines, comboSections };
}

function stripProfilesetPrefix(line: string, sectionName: string): string {
  const prefix = `profileset."${sectionName}"+=`;
  return line.startsWith(prefix) ? line.slice(prefix.length) : line;
}

function mergeAssignmentLines(baseLines: string[], overlayLines: string[]): string[] {
  const assignments = new Map<string, string>();
  const order: string[] = [];

  const applyLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return;
    const key = trimmed.slice(0, eqIndex).trim();
    if (!assignments.has(key)) order.push(key);
    assignments.set(key, trimmed);
  };

  baseLines.forEach(applyLine);
  overlayLines.forEach(applyLine);

  return order.map((key) => assignments.get(key)!).filter(Boolean);
}

export function buildExactTopGearSimInput(
  generatedInput: string,
  profilesetName: string
): string | null {
  const { baseActorLines, comboSections } = splitGeneratedInput(generatedInput);
  const baselineLines = comboSections.get('Combo 1');
  const selectedLines = comboSections.get(profilesetName);

  if (!baselineLines || !selectedLines) return null;

  const normalizedSelectedLines =
    profilesetName === 'Combo 1'
      ? selectedLines
      : selectedLines.map((line) => stripProfilesetPrefix(line, profilesetName));

  const mergedAssignments = mergeAssignmentLines(baselineLines, normalizedSelectedLines);
  return [...baseActorLines.filter((line) => line.trim().length > 0), ...mergedAssignments].join('\n');
}

export function getTopGearProfilesetName(result: TopGearResult): string | null {
  const raw = result.profileset_name?.trim();
  return raw ? raw : null;
}
