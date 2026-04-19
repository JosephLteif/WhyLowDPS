import DungeonPageClient from './DungeonPageClient';

const MAX_STATIC_DUNGEON_ID = 500;

export function generateStaticParams() {
  return Array.from({ length: MAX_STATIC_DUNGEON_ID }, (_, idx) => ({
    id: String(idx + 1),
  }));
}

export default async function DungeonPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  return <DungeonPageClient id={resolvedParams.id} />;
}
