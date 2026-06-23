# WoW Season Content Data

WhyLowDPS keeps structured WoW content data in `backend/resources/wow` as the single bundled
source. At runtime those files live in `AppData/Roaming/com.whylowdps/data/wow`, restored through
Settings -> Game Data File States.

## Blizzard-derived files

These files should be regenerated from the Blizzard API at build or maintenance time:

- `wow-expansions.json`: journal expansions.
- `wow-instances.json`: journal raids and dungeons.
- `wow-encounters.json`: journal encounters keyed to their journal instance.
- `wow-mythic-plus-dungeons.json`: Mythic Keystone dungeon ID to journal instance ID mappings.

Run:

```powershell
$env:BLIZZARD_CLIENT_ID = "..."
$env:BLIZZARD_CLIENT_SECRET = "..."
npm run generate:wow-content
```

To generate directly into the desktop app data directory:

```powershell
$env:WOW_CONTENT_OUTPUT_DIR = "$env:APPDATA/com.whylowdps/data/wow"
npm run generate:wow-content
```

The script writes Blizzard-derived JSON into `backend/resources/wow` for packaging. Use Game Data
File States to restore those files into the app data directory.
It does not generate `wow-seasons.json`. Do not put Blizzard credentials in frontend or Tauri code.

## Manual season mapping

`wow-seasons.json` is the single curated season file. It may include both the ID lists and the
expanded embedded season content used by the UI. Keep the bundled seed in `backend/resources/wow`
in sync, then restore it through Game Data File States so the runtime copy in app data is updated.
Each season entry maps:

- `slug`
- `name`
- `expansionId`
- `patch`
- `startDate` / `endDate` when known
- `raidInstanceIds`
- `mythicPlusDungeonIds`
- optional embedded `raidInstances`, `mythicPlusDungeons`, and related season metadata

To add a future season:

1. Regenerate the Blizzard-derived files.
2. Add or update the season entry in `wow-seasons.json`.
3. Use journal instance IDs for raids.
4. Use Blizzard Mythic Keystone dungeon IDs for the M+ rotation when available; otherwise use journal instance IDs from `wow-instances.json`.
5. Run `npm run test --prefix frontend -- wow-season-content.test.ts`.

The normalizer in `frontend/src/app/lib/wow-season-content.ts` joins seasons, instances, encounters, and Mythic+ dungeon IDs into `WowSeasonContent`. It warns for missing IDs and duplicate IDs. The new data model intentionally has no Wowhead, Raider.IO, WarcraftLogs, generic link, or placeholder external link fields.

For the season-by-season operator checklist, including Warcraft Logs guide alias maintenance and runtime file expectations, see [docs/wow-season-manual-updates.md](./wow-season-manual-updates.md).
