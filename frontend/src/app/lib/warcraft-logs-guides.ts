import guideMappings from '../../../../backend/resources/wow/warcraft-logs-guides.json';

function normalizeEncounterName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

type GuideMapping = {
  slug: string;
  encounterNames: string[];
};

const guideUrlByEncounterName = new Map<string, string>();

for (const mapping of guideMappings as GuideMapping[]) {
  const guideUrl = `https://www.warcraftlogs.com/guide/${mapping.slug}`;
  for (const encounterName of mapping.encounterNames ?? []) {
    guideUrlByEncounterName.set(normalizeEncounterName(encounterName), guideUrl);
  }
}

export function getWarcraftLogsGuideUrl(encounterName: string): string | null {
  if (!encounterName) return null;
  return guideUrlByEncounterName.get(normalizeEncounterName(encounterName)) ?? null;
}
