# WoW Season Content Data

WhyLowDPS keeps structured WoW content data in `frontend/src/app/data/wow`.

## Blizzard-derived files

These files should be regenerated from the Blizzard API at build or maintenance time:

- `wow-expansions.json`: journal expansions.
- `wow-instances.json`: journal raids and dungeons, plus Mythic+ dungeon ID mappings when Blizzard exposes them.
- `wow-encounters.json`: journal encounters keyed to their journal instance.

Run:

```powershell
$env:BLIZZARD_CLIENT_ID = "..."
$env:BLIZZARD_CLIENT_SECRET = "..."
node scripts/generate-blizzard-wow-content.mjs
```

The script writes static JSON only. Do not put Blizzard credentials in frontend or Tauri code.

## Manual season mapping

`wow-seasons.json` is curated by hand. Each season entry maps:

- `slug`
- `name`
- `expansionId`
- `patch`
- `startDate` / `endDate` when known
- `raidInstanceIds`
- `mythicPlusDungeonIds`

To add a future season:

1. Regenerate the Blizzard-derived files.
2. Add a new entry to `wow-seasons.json`.
3. Use journal instance IDs for raids.
4. Use Blizzard Mythic Keystone dungeon IDs for the M+ rotation when available; otherwise use journal instance IDs from `wow-instances.json`.
5. Run `npm run test --prefix frontend -- wow-season-content.test.ts`.

The normalizer in `frontend/src/app/lib/wow-season-content.ts` joins seasons, instances, encounters, and Mythic+ dungeon IDs into `WowSeasonContent`. It warns for missing IDs and duplicate IDs. The new data model intentionally has no Wowhead, Raider.IO, WarcraftLogs, generic link, or placeholder external link fields.
