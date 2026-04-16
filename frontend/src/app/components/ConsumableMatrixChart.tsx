'use client';

import { useMemo } from 'react';
import { useConsumableOptions } from '../lib/useConsumableOptions';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import { RAID_BUFF_MATRIX_OPTIONS } from '../lib/sim-options-catalog';

interface MatrixResult {
  name: string;
  dps: number;
  delta: number;
  items?: Array<Record<string, unknown>>;
}

const CATEGORY_LABELS: Record<string, string> = {
  flask: 'Flasks',
  food: 'Food',
  potion: 'Potions',
  augmentation: 'Augmentation Runes',
  temporary_enchant: 'Temporary Enchants',
  raid_buff: 'Raid Buffs',
};

function optionQualityFamily(token: string) {
  return token.replace(/^main_hand:/, '').replace(/_[1-3]$/i, '');
}

function remapQuality(quality: number | undefined, familyMax: number | undefined) {
  if (!quality || quality < 1 || quality > 3) return undefined;
  if (familyMax === 2) {
    if (quality === 1) return 2; // silver
    if (quality === 2) return 3; // gold
  }
  return quality; // bronze/silver/gold
}

function qualityName(quality: number | undefined) {
  if (quality === 3) return 'Gold';
  if (quality === 2) return 'Silver';
  if (quality === 1) return 'Bronze';
  return '';
}

function QualityBadge({ quality }: { quality?: number }) {
  if (!quality || quality < 1 || quality > 3) return null;
  const style =
    quality === 3
      ? 'border-amber-300/60 bg-gradient-to-b from-amber-200 to-amber-500'
      : quality === 2
        ? 'border-zinc-300/60 bg-gradient-to-b from-zinc-100 to-zinc-400'
        : 'border-orange-400/60 bg-gradient-to-b from-orange-200 to-orange-500';
  return (
    <span
      className={`inline-block h-3.5 w-3.5 rotate-45 rounded-[2px] border ${style}`}
      title={`Quality ${quality}`}
      aria-label={`Quality ${quality}`}
    />
  );
}

function normalizeLabel(input: string) {
  return input.replace(/\s*\(Quality\s*[1-3]\)\s*$/i, '').replace(/\s+[1-3]\s*$/i, '');
}

const spellIconCache = new Map<number, string>();
const itemIconCache = new Map<number, string>();

function useSpellIcons(spellIds: number[]) {
  const [icons, setIcons] = useState<Map<number, string>>(new Map());
  const depKey = spellIds.join(',');

  useEffect(() => {
    const missing = spellIds.filter((id) => id > 0 && !spellIconCache.has(id));
    if (missing.length === 0) {
      setIcons(new Map(spellIconCache));
      return;
    }
    let cancelled = false;
    Promise.all(
      missing.map(async (id) => {
        try {
          const res = await fetch(`https://nether.wowhead.com/tooltip/spell/${id}?dataEnv=1&locale=0`);
          if (!res.ok) return;
          const data = await res.json();
          if (data?.icon) spellIconCache.set(id, data.icon);
        } catch {}
      })
    ).then(() => {
      if (!cancelled) setIcons(new Map(spellIconCache));
    });
    return () => {
      cancelled = true;
    };
  }, [depKey]);
  return icons;
}

function useItemIcons(itemIds: number[]) {
  const [icons, setIcons] = useState<Map<number, string>>(new Map());
  const depKey = itemIds.join(',');

  useEffect(() => {
    const missing = itemIds.filter((id) => id > 0 && !itemIconCache.has(id));
    if (missing.length === 0) {
      setIcons(new Map(itemIconCache));
      return;
    }
    let cancelled = false;
    Promise.all(
      missing.map(async (id) => {
        try {
          const res = await fetch(`https://nether.wowhead.com/tooltip/item/${id}?dataEnv=1&locale=0`);
          if (!res.ok) return;
          const data = await res.json();
          if (data?.icon) itemIconCache.set(id, data.icon);
        } catch {}
      })
    ).then(() => {
      if (!cancelled) setIcons(new Map(itemIconCache));
    });
    return () => {
      cancelled = true;
    };
  }, [depKey]);
  return icons;
}

export default function ConsumableMatrixChart({
  baseDps,
  results,
}: {
  baseDps: number;
  results: MatrixResult[];
}) {
  const { flasks, foods, potions, augments, tempEnchants } = useConsumableOptions(11);
  const raidBuffByKey = useMemo(() => new Map(RAID_BUFF_MATRIX_OPTIONS.map((b) => [b.key, b])), []);

  const allItemIds = useMemo(() => {
    const all = [...flasks, ...foods, ...potions, ...augments, ...tempEnchants];
    return all.map((o) => o.itemId).filter((id): id is number => !!id);
  }, [flasks, foods, potions, augments, tempEnchants]);
  const itemIcons = useItemIcons(allItemIds);

  const raidBuffSpellIds = useMemo(() => {
    return RAID_BUFF_MATRIX_OPTIONS.map((b) => b.spellId).filter((id): id is number => !!id);
  }, []);
  const spellIcons = useSpellIcons(raidBuffSpellIds);

  const optionByCategory = useMemo(
    () => ({
      flask: new Map(flasks.map((o) => [o.token || '', o])),
      food: new Map(foods.map((o) => [o.token || '', o])),
      potion: new Map(potions.map((o) => [o.token || '', o])),
      augmentation: new Map(augments.map((o) => [o.token || '', o])),
      temporary_enchant: new Map(tempEnchants.map((o) => [o.token || '', o])),
    }),
    [flasks, foods, potions, augments, tempEnchants]
  );

  const maxQualityByFamily = useMemo(() => {
    const map = new Map<string, number>();
    const all = [...flasks, ...foods, ...potions, ...augments, ...tempEnchants];
    for (const opt of all) {
      const family = optionQualityFamily(opt.token || '');
      const q = opt.craftingQuality || 0;
      map.set(family, Math.max(map.get(family) || 0, q));
    }
    return map;
  }, [flasks, foods, potions, augments, tempEnchants]);

  const rawRows = results
    .filter(
      (r) =>
        !String(r.name || '')
          .toLowerCase()
          .includes('currently equipped')
    )
    .map((r) => {
      const tagged = Array.isArray(r.items)
        ? r.items.find((i) => typeof i.consumable_category === 'string')
        : null;
      const category =
        (tagged && typeof tagged.consumable_category === 'string'
          ? tagged.consumable_category
          : 'other') || 'other';
      const token =
        (tagged && typeof tagged.consumable_token === 'string' ? tagged.consumable_token : null) ||
        String(r.name || '')
          .split('|')
          .pop()
          ?.trim() ||
        String(r.name || 'Unknown');
      return {
        category,
        token,
        rawName: String(r.name || ''),
        dps: Number(r.dps || 0),
        delta: Number(r.delta || 0),
      };
    });

  const deduped = new Map<string, (typeof rawRows)[number]>();
  for (const row of rawRows) {
    const key = `${row.category}:${row.token}`;
    const existing = deduped.get(key);
    if (!existing || row.delta > existing.delta) {
      deduped.set(key, row);
    }
  }
  const rows = Array.from(deduped.values()).sort((a, b) => b.delta - a.delta);

  const grouped = rows.reduce<Record<string, typeof rows>>((acc, row) => {
    (acc[row.category] ||= []).push(row);
    return acc;
  }, {});

  const categories = Object.keys(grouped);
  useWowheadTooltips([
    results.length,
    categories.length,
    flasks.length,
    foods.length,
    potions.length,
    augments.length,
    tempEnchants.length,
  ]);

  return (
    <div className="card p-5">
      <h3 className="mb-2 text-sm font-semibold text-zinc-100">Consumable Matrix</h3>
      <p className="mb-4 text-xs text-zinc-400">
        Baseline DPS: {Math.round(baseDps).toLocaleString()}. Positive values are gains over
        baseline.
      </p>
      <div className="space-y-4">
        {categories.map((category) => (
          <div key={category} className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              {CATEGORY_LABELS[category] || category}
            </div>
            {grouped[category].map((row, rowIndex) => {
              const opt = (optionByCategory as any)?.[category]?.get?.(row.token);
              const raidBuff = category === 'raid_buff' ? raidBuffByKey.get(row.token) : null;
              const displayName = opt
                ? normalizeLabel(opt.label || row.token)
                : raidBuff
                  ? raidBuff.label
                  : normalizeLabel(row.token || row.rawName || 'Unknown');
              const quality = opt
                ? remapQuality(
                    opt.craftingQuality,
                    maxQualityByFamily.get(optionQualityFamily(opt.token || ''))
                  )
                : undefined;
              const tier = qualityName(quality);
              const wowhead =
                opt?.itemId != null
                  ? `item=${opt.itemId}`
                  : raidBuff?.spellId != null
                    ? `spell=${raidBuff.spellId}`
                    : undefined;
              const resolvedIcon =
                (opt?.itemId && itemIcons.get(opt.itemId)) ||
                (raidBuff?.spellId && spellIcons.get(raidBuff.spellId)) ||
                opt?.icon ||
                raidBuff?.icon ||
                '';
              return (
                <div
                  key={`${category}:${row.token}:${row.rawName}:${rowIndex}`}
                  className="flex items-center justify-between rounded-md border border-border bg-surface-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <a
                      href="#"
                      onClick={(e) => e.preventDefault()}
                      data-wowhead={wowhead}
                      className="flex min-w-0 items-center gap-2 text-sm text-zinc-200"
                    >
                      {resolvedIcon ? (
                        <span
                          className="h-4 w-4 shrink-0 rounded-[3px] bg-cover bg-center"
                          style={{
                            backgroundImage: `url(https://wow.zamimg.com/images/wow/icons/small/${resolvedIcon}.jpg)`,
                          }}
                        />
                      ) : (
                        <span className="h-4 w-4 shrink-0 rounded-[3px] border border-border bg-surface" />
                      )}
                      <span className="truncate">{displayName}</span>
                      {quality ? <QualityBadge quality={quality} /> : null}
                      {tier ? <span className="text-[11px] text-zinc-500">{tier}</span> : null}
                    </a>
                  </div>
                  <span className={row.delta >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                    {row.delta >= 0 ? '+' : ''}
                    {Math.round(row.delta).toLocaleString()} DPS
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
