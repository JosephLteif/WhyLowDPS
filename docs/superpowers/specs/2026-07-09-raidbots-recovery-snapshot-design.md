# Raidbots Recovery Snapshot Design

## Goal

Let desktop users recover missing Raidbots data without relying on Raidbots at repair time. The recovery path must not participate in desktop application updates.

## Scope

- Change the desktop **Repair Missing Files** flow only.
- Keep normal background data sync pointed at Raidbots for current data.
- Keep existing bundled-file restoration before any network recovery.
- Publish a verified recovery snapshot every six hours and on manual dispatch.

Out of scope: changing the Tauri updater, shipping data in installers, or replacing the normal Raidbots sync path.

## Architecture

Create a separate public repository, `whylowdps-game-data`, with a scheduled GitHub Actions workflow. It owns a fixed GitHub Release tag, `recovery-latest`, which is unrelated to versioned application releases.

The workflow fetches Raidbots `metadata.json` and every file referenced by it. It validates the downloaded set before publishing these assets:

- `snapshot.zip`: the fetched files, preserving their relative paths.
- `manifest.json`: schema version, generated-at timestamp, Raidbots metadata hash, archive SHA-256, and per-file relative path, byte size, and SHA-256.

The workflow replaces the fixed release assets only after all fetch and validation steps succeed. A failed run retains the previous snapshot. The release retains no desktop installer, Tauri updater manifest, or application `v*` tag; desktop update code never queries this repository.

## Desktop repair flow

1. Discover required missing entries through the existing data catalog.
2. Restore any bundled/local entries using the existing local restoration path.
3. When Raidbots-backed entries remain missing, fetch `manifest.json` from the recovery release.
4. Reject the snapshot if its schema is unsupported, it is older than 24 hours, its archive checksum is invalid, or its manifest cannot cover every required missing entry.
5. Download `snapshot.zip` to a temporary directory, verify its checksum, and safely extract only manifest-listed paths. Reject absolute paths, traversal paths, duplicate entries, unexpected archive entries, hash mismatches, and size mismatches.
6. Verify every required candidate file before applying any change to the live data directory.
7. Atomically stage the verified files into the data directory, then reload the item database and runtime metadata as the current repair flow does.
8. If snapshot recovery fails, attempt the existing direct Raidbots download only for still-missing entries. Return errors identifying whether recovery snapshot, Raidbots fallback, or both failed.

No failure may remove or overwrite an existing live data file. The staged repair is all-or-nothing for the files restored from the snapshot.

## User experience

The existing **Repair Missing Files** button remains the entry point. While it runs, display the active source and actual progress:

- `Restoring packaged data…`
- `Downloading verified recovery snapshot…`
- `Verifying recovery data…`
- `Applying repaired files…`
- `Recovery snapshot unavailable; trying Raidbots…`

The result must state which source repaired the data and list any remaining required files. Remove the manual-recovery guidance that suggests manually editing `metadata.json` or rerunning repair without explaining the source failure.

## Configuration and release isolation

The desktop backend uses one explicit recovery-manifest base URL for the separate data repository. This URL is distinct from the Tauri updater endpoint and the existing versioned zones-index release URL.

The recovery release must use a non-version tag (`recovery-latest`) and be hosted outside the desktop application repository. Consequently, application-update discovery cannot mistake a recovery snapshot for a desktop release.

## Validation

Add focused tests for:

- manifest schema, stale snapshot rejection, checksum and size validation;
- archive path safety and unexpected-entry rejection;
- partial downloads and failed verification preserving the live directory;
- successful staged apply and database reload;
- bundled-data restoration preceding snapshot recovery;
- recovery snapshot preference over Raidbots;
- Raidbots fallback when the snapshot is missing, stale, or invalid;
- the scheduled publisher refusing to replace the current release after an incomplete or invalid Raidbots fetch.

Manual acceptance check: temporarily remove a required Raidbots file with Raidbots unreachable, press **Repair Missing Files**, and verify that the latest valid recovery snapshot restores it without triggering an app update check.
