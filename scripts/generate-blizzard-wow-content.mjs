#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const REGION = process.env.BLIZZARD_REGION || 'us';
const LOCALE = process.env.BLIZZARD_LOCALE || 'en_US';
const CLIENT_ID = process.env.BLIZZARD_CLIENT_ID;
const CLIENT_SECRET = process.env.BLIZZARD_CLIENT_SECRET;
const BACKEND_RESOURCE_OUTPUT_DIR = path.resolve('backend/resources/wow');
const EXTRA_OUTPUT_DIR = process.env.WOW_CONTENT_OUTPUT_DIR
  ? path.resolve(process.env.WOW_CONTENT_OUTPUT_DIR)
  : null;

function usage() {
  console.error(
    'Usage: BLIZZARD_CLIENT_ID=... BLIZZARD_CLIENT_SECRET=... node scripts/generate-blizzard-wow-content.mjs'
  );
}

function localizedName(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return value[LOCALE] || value.en_US || Object.values(value)[0];
  return undefined;
}

function idFromHref(href, marker) {
  if (!href) return undefined;
  const tail = String(href).split(marker)[1]?.split('?')[0];
  const id = Number(tail);
  return Number.isFinite(id) ? id : undefined;
}

async function getToken() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    usage();
    process.exit(2);
  }

  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  const response = await fetch('https://oauth.battle.net/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) throw new Error(`Blizzard OAuth failed: HTTP ${response.status}`);
  const payload = await response.json();
  return payload.access_token;
}

function blizzardFetcher(token) {
  return async function fetchBlizzard(apiPath, namespace) {
    const separator = apiPath.includes('?') ? '&' : '?';
    const url = `https://${REGION}.api.blizzard.com${apiPath}${separator}namespace=${namespace}-${REGION}&locale=${LOCALE}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`${apiPath} failed: HTTP ${response.status}`);
    return response.json();
  };
}

async function optional(fetcher, fallback) {
  try {
    return await fetcher();
  } catch (error) {
    console.warn(error.message);
    return fallback;
  }
}

async function main() {
  const token = await getToken();
  const fetchBlizzard = blizzardFetcher(token);

  const expansionIndex = await fetchBlizzard('/data/wow/journal-expansion/index', 'static');
  const expansionRefs = expansionIndex.tiers || expansionIndex.expansions || [];
  const expansions = [];
  for (const ref of expansionRefs) {
    const id = ref.id ?? idFromHref(ref.key?.href, '/journal-expansion/');
    if (!id) continue;
    const detail = await fetchBlizzard(`/data/wow/journal-expansion/${id}`, 'static');
    const name = localizedName(detail.name) || localizedName(ref.name) || `Expansion ${id}`;
    expansions.push({
      id,
      name,
      slug: name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    });
  }

  const instanceIndex = await fetchBlizzard('/data/wow/journal-instance/index', 'static');
  const instanceRefs = instanceIndex.instances || [];
  const mplusIndex = await optional(
    () => fetchBlizzard('/data/wow/mythic-keystone/dungeon/index', 'dynamic'),
    { dungeons: [] }
  );
  const mplusByJournalId = new Map();
  const mythicPlusDungeonMappings = [];
  for (const dungeon of mplusIndex.dungeons || []) {
    const detail = await optional(
      () => fetchBlizzard(`/data/wow/mythic-keystone/dungeon/${dungeon.id}`, 'dynamic'),
      null
    );
    const journalId = detail?.journal_instance?.id;
    if (journalId) {
      mplusByJournalId.set(journalId, dungeon.id);
      mythicPlusDungeonMappings.push({
        mythicPlusDungeonId: dungeon.id,
        journalInstanceId: journalId,
      });
    }
  }

  const instances = [];
  const encounters = [];
  for (const ref of instanceRefs) {
    const id = ref.id ?? idFromHref(ref.key?.href, '/journal-instance/');
    if (!id) continue;
    const detail = await optional(
      () => fetchBlizzard(`/data/wow/journal-instance/${id}`, 'static'),
      null
    );
    if (!detail) continue;

    const type = String(detail.category?.type || detail.type || '').toLowerCase();
    if (type !== 'raid' && type !== 'dungeon') continue;

    const encounterIds = [];
    for (const encounterRef of detail.encounters || []) {
      const encounterId = encounterRef.id ?? idFromHref(encounterRef.key?.href, '/journal-encounter/');
      if (!encounterId) continue;
      encounterIds.push(encounterId);
      const encounterDetail = await optional(
        () => fetchBlizzard(`/data/wow/journal-encounter/${encounterId}`, 'static'),
        encounterRef
      );
      encounters.push({
        id: encounterId,
        name:
          localizedName(encounterDetail.name) ||
          localizedName(encounterRef.name) ||
          `Encounter ${encounterId}`,
        instanceId: id,
        order: encounterIds.length,
      });
    }

    const media = await optional(
      () => fetchBlizzard(`/data/wow/media/journal-instance/${id}`, 'static'),
      null
    );
    const imageUrl = media?.assets?.find((asset) => asset.key === 'tile')?.value;

    instances.push({
      id,
      name: localizedName(detail.name) || localizedName(ref.name) || `Instance ${id}`,
      type,
      expansionId: detail.expansion?.id || 0,
      slug: detail.slug,
      journalInstanceId: id,
      mythicPlusDungeonId: mplusByJournalId.get(id),
      encounterIds,
      imageUrl,
    });
  }

  const outputDirs = [BACKEND_RESOURCE_OUTPUT_DIR];
  if (EXTRA_OUTPUT_DIR) outputDirs.push(EXTRA_OUTPUT_DIR);
  for (const outputDir of outputDirs) {
    await fs.mkdir(outputDir, { recursive: true });
  }
  const generatedFiles = [
    ['wow-expansions.json', expansions],
    ['wow-instances.json', instances],
    ['wow-encounters.json', encounters],
    ['wow-mythic-plus-dungeons.json', mythicPlusDungeonMappings],
  ];
  for (const [fileName, data] of generatedFiles) {
    const content = JSON.stringify(data, null, 2);
    for (const outputDir of outputDirs) {
      await fs.writeFile(path.join(outputDir, fileName), content);
    }
  }
  console.log(
    `Wrote ${expansions.length} expansions, ${instances.length} instances, ${encounters.length} encounters, ${mythicPlusDungeonMappings.length} Mythic+ dungeon mappings`
  );
  console.log(`Output directories: ${outputDirs.join(', ')}`);
  console.log('Season mappings are curated manually in wow-seasons.json and restored through Game Data File States.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
