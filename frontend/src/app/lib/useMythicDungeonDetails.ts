import { useEffect, useState } from 'react';
import {
  getMythicKeystoneDungeonDetail,
  getMythicKeystoneDungeonIndex,
  type MythicKeystoneDungeonDetail,
} from './api';

export function useMythicDungeonDetails(region = 'us'): Record<string, MythicKeystoneDungeonDetail> {
  const [detailsByName, setDetailsByName] = useState<Record<string, MythicKeystoneDungeonDetail>>({});

  useEffect(() => {
    let cancelled = false;

    getMythicKeystoneDungeonIndex(region)
      .then(async (indexData) => {
        const indexEntries = Array.isArray(indexData?.dungeons) ? indexData.dungeons : [];
        const detailResults = await Promise.all(
          indexEntries.map((entry) =>
            getMythicKeystoneDungeonDetail(Number(entry?.id), region).catch(() => null)
          )
        );
        if (cancelled) return;

        const nextMap: Record<string, MythicKeystoneDungeonDetail> = {};
        for (const detail of detailResults) {
          if (!detail || typeof detail !== 'object') continue;
          const normalized = String(detail.name || '')
            .trim()
            .toLowerCase();
          if (normalized) nextMap[normalized] = detail;
        }
        setDetailsByName(nextMap);
      })
      .catch(() => {
        if (!cancelled) setDetailsByName({});
      });

    return () => {
      cancelled = true;
    };
  }, [region]);

  return detailsByName;
}
