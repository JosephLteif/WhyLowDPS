import DungeonPageClient from './DungeonPageClient';
import fs from 'node:fs/promises';
import path from 'node:path';

type ZoneEntry = {
  id?: number;
  is_dungeon?: boolean;
  is_raid?: boolean;
};

type ZonesIndexFile = {
  zones?: ZoneEntry[];
};

export async function generateStaticParams() {
  const ids = new Set<number>();

  try {
    const zonesPath = path.resolve(process.cwd(), '../backend/resources/zones-encounters-index.json');
    const raw = await fs.readFile(zonesPath, 'utf8');
    const parsed = JSON.parse(raw) as ZonesIndexFile;
    for (const zone of parsed.zones ?? []) {
      const id = Number(zone?.id ?? 0);
      if (!Number.isFinite(id) || id <= 0) continue;
      if (zone?.is_raid) continue;
      if (zone?.is_dungeon === false) continue;
      ids.add(id);
    }
  } catch {
    // Keep route generation resilient; fallback IDs are used below when local data is unavailable.
  }

  if (ids.size === 0) {
    return Array.from({ length: 5000 }, (_, idx) => ({ id: String(idx + 1) }));
  }

  return Array.from(ids)
    .sort((a, b) => a - b)
    .map((id) => ({ id: String(id) }));
}

export default async function DungeonPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  return <DungeonPageClient id={resolvedParams.id} />;
}
