'use client';

import { useSearchParams } from 'next/navigation';
import DungeonPageClient from '../[id]/DungeonPageClient';

export default function DungeonDetailsPage() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id') ?? '';
  return <DungeonPageClient id={id} />;
}
