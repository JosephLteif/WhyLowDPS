'use client';

import { useSearchParams } from 'next/navigation';
import DungeonPageClient from '../../dungeons/[id]/DungeonPageClient';

export default function RaidDetailsPage() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id') ?? '';
  return <DungeonPageClient id={id} kind="raid" />;
}
