# WoW Season Manual Update Guide

This document is the manual checklist for rolling WhyLowDPS forward to a new WoW season.

It covers the curated pieces that are not fully derived from one upstream source:

- season definitions in `backend/resources/wow/wow-seasons.json`
- Warcraft Logs guide mappings in `backend/resources/wow/warcraft-logs-guides.json`
- runtime copy expectations for the desktop app data folder

For the Blizzard-derived base files and generator usage, see [docs/wow-season-data.md](./wow-season-data.md).

## Source Of Truth

Bundled repo files:

- `backend/resources/wow/wow-expansions.json`
- `backend/resources/wow/wow-instances.json`
- `backend/resources/wow/wow-encounters.json`
- `backend/resources/wow/wow-mythic-plus-dungeons.json`
- `backend/resources/wow/wow-seasons.json`
- `backend/resources/wow/warcraft-logs-guides.json`
- `backend/resources/zones-encounters-index.json`

Desktop runtime copies:

- `%APPDATA%/com.whylowdps/data/wow/wow-expansions.json`
- `%APPDATA%/com.whylowdps/data/wow/wow-instances.json`
- `%APPDATA%/com.whylowdps/data/wow/wow-encounters.json`
- `%APPDATA%/com.whylowdps/data/wow/wow-mythic-plus-dungeons.json`
- `%APPDATA%/com.whylowdps/data/wow/wow-seasons.json`

Notes:

- `wow-seasons.json` is explicitly listed as a required local file in `backend/resources/data-manifest.json`.
- `warcraft-logs-guides.json` is currently bundled for frontend use from the repo copy. It is not part of the runtime data-manifest restore flow.
- Do not add external-link fields to `wow-seasons.json`, `wow-instances.json`, or `wow-encounters.json`. The canonical season content model intentionally rejects fields like `wowheadUrl`, `warcraftLogsUrl`, and generic `links`.

## When A New Season Starts

Use this order:

1. Refresh Blizzard-derived base files.
2. Update the curated season entry in `wow-seasons.json`.
3. Update Warcraft Logs guide mappings for the current season.
4. Verify current-season selection and details-page mappings.
5. Restore updated runtime files if you are validating the desktop app.

## 1. Refresh Blizzard-Derived Base Files

From the repo root:

```powershell
$env:BLIZZARD_CLIENT_ID = "..."
$env:BLIZZARD_CLIENT_SECRET = "..."
npm run generate:wow-content
```

This updates:

- `backend/resources/wow/wow-expansions.json`
- `backend/resources/wow/wow-instances.json`
- `backend/resources/wow/wow-encounters.json`
- `backend/resources/wow/wow-mythic-plus-dungeons.json`

If you want to write directly into the desktop runtime folder while testing:

```powershell
$env:BLIZZARD_CLIENT_ID = "..."
$env:BLIZZARD_CLIENT_SECRET = "..."
$env:WOW_CONTENT_OUTPUT_DIR = "$env:APPDATA/com.whylowdps/data/wow"
npm run generate:wow-content
```

## 2. Update `wow-seasons.json`

File:

- `backend/resources/wow/wow-seasons.json`

Add a new season entry or update the current one with:

- `slug`
- `name`
- `expansionId`
- `patch`
- `startDate`
- `endDate` when known
- `raidInstanceIds`
- `mythicPlusDungeonIds`
- embedded `raidInstances` when the UI needs a curated raid pool
- embedded `mythicPlusDungeons` when the UI needs a curated M+ pool
- any explanatory `source`, `warnings`, or `counts` fields already used by nearby seasons

Rules:

- Use journal instance IDs for raids.
- Use Blizzard Mythic Keystone dungeon IDs for `mythicPlusDungeonIds` when available.
- If a season needs a curated or split pool, follow the existing embedded-season pattern already used in this file.
- Keep `startDate` and `endDate` correct. The frontend chooses the default current season by date, not by array order.
- Keep the new entry consistent with nearby seasons in the same expansion.

Useful references while editing:

- `backend/resources/wow/wow-instances.json`
- `backend/resources/wow/wow-encounters.json`
- `frontend/src/app/lib/wow-season-content.ts`
- `frontend/src/app/lib/wow-season-content.test.ts`

## 3. Update Warcraft Logs Guide Mappings

File:

- `backend/resources/wow/warcraft-logs-guides.json`

This file is the manual mapping from displayed encounter names to Warcraft Logs guide slugs.

Current shape:

```json
{
  "slug": "lightblinded-vanguard",
  "encounterNames": ["Lightblinded Vanguard", "War Chaplain Senn", "Bellamy", "Lightblood"]
}
```

Update it for the current season by:

1. Adding one entry per guide slug for each current-season boss.
2. Including the canonical raid boss name from `wow-seasons.json`.
3. Adding alias names that come from Wowhead details data when they differ from the canonical encounter name.

Common alias cases:

- a multi-NPC fight where Wowhead exposes one NPC name instead of the encounter name
- a council fight where details cards show one member, not the encounter title
- a staged fight where the details payload uses an NPC actor name

Examples from the current data:

- `Vaelgor & Ezzorak` also needs `Vaelgor` and `Ezzorak`
- `Lightblinded Vanguard` also needs `War Chaplain Senn`, `Bellamy`, and `Lightblood`
- `Crown of the Cosmos` also needs `Alleria Windrunner`

Where to find the alias names:

- `backend/resources/zones-encounters-index.json`
- details-page rendering in `frontend/src/app/dungeons/[id]/DungeonPageClient.tsx`

Practical workflow:

1. Open the current raid details page in the app.
2. Check which encounter cards are missing the `Guide` button.
3. Search those displayed names in `backend/resources/zones-encounters-index.json`.
4. Add the displayed name into the correct `encounterNames` array in `warcraft-logs-guides.json`.

Do not put these guide URLs into `wow-seasons.json` or the normalized season content model.

## 4. Optional Curated Wowhead Zone Maintenance

If the details page shows the wrong encounter roster or actor names for the season, inspect:

- `backend/resources/zones-encounters-index.json`

This file is separate from the canonical season content. It is used for richer Wowhead-style details pages and can expose NPC-level encounter names that differ from the curated season encounter names.

If this file changes, re-check:

- raid details cards
- `Guide` button presence
- `Wowhead` button targets

## 5. Restore Runtime Files For Desktop Validation

If you are validating the desktop app, make sure the runtime copies under `%APPDATA%/com.whylowdps/data/wow` are updated.

The app can restore bundled/local files through:

- `Settings -> Game Data File States`

Manual reminder from the current UI:

- `wow-seasons.json` is expected under `%APPDATA%/com.whylowdps/data/wow`

## Focused Validation

Prefer the smallest checks that cover season maintenance:

```powershell
npm exec vitest run src/app/lib/wow-season-content.test.ts
npm exec vitest run src/app/raids/raid-expansion-filter.test.ts
npm exec vitest run src/app/lib/warcraft-logs-guides.test.ts
npm exec vitest run src/app/dungeons/[id]/DungeonPageClient.test.tsx
npm exec vitest run src/app/dungeons/shared.test.tsx
npm exec vitest run src/app/components/RaidProgressionGrid.test.tsx
```

Run them from `frontend/`.

What they cover:

- season normalization and current-season selection
- raids page default expansion behavior
- Warcraft Logs guide alias mapping
- details-page guide button rendering
- raid-card guide links
- character raid progression guide links

Use broader validation only if the season data change is large.

## Season Update Checklist

- Regenerated Blizzard-derived WoW files.
- Updated `wow-seasons.json`.
- Confirmed `startDate` and `endDate`.
- Confirmed raid journal instance IDs.
- Confirmed Mythic+ dungeon IDs.
- Updated `warcraft-logs-guides.json`.
- Added alias names for any details-page NPC names.
- Restored runtime files if testing desktop.
- Ran the focused frontend tests.

## Files Most Likely To Change Per Season

- `backend/resources/wow/wow-seasons.json`
- `backend/resources/wow/warcraft-logs-guides.json`
- `backend/resources/wow/wow-expansions.json`
- `backend/resources/wow/wow-instances.json`
- `backend/resources/wow/wow-encounters.json`
- `backend/resources/wow/wow-mythic-plus-dungeons.json`

Less common but worth checking:

- `backend/resources/zones-encounters-index.json`
- `frontend/src/app/lib/wow-season-content.test.ts`
- `frontend/src/app/lib/warcraft-logs-guides.test.ts`
- `frontend/src/app/dungeons/[id]/DungeonPageClient.test.tsx`
