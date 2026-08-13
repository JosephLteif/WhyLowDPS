# Changelog

All notable changes to WhyLowDPS should be documented in this file.

The format is based on Keep a Changelog and this project uses semantic versioning for stable releases.

## [Unreleased]

### Added

- Season-aware Loot Browser grouping by expansion, season, and active dungeon rotation.
- Resizable Loot Browser instance panel with mouse and keyboard controls.

### Fixed

- Active dungeon selections stay in the Active Dungeons group instead of jumping to their source expansion.
- Active dungeons now show a clickable source-expansion link for historical views.
- Current-season ilvl controls are available for active legacy dungeons and disabled for older expansion and season views.
- Incomplete instance metadata is reconciled with trusted fallback data when seasonal Raidbots data changes.

## [3.0.1] - 2026-05-19

### Changed

- Release workflow now generates structured release notes with:
  - recommended download
  - SHA256 checksums for every attached asset
  - explicit Windows/SmartScreen/Battle.net credential notes

### Added

- First-launch Discord invite popup with local dismiss persistence
- Sidebar quick links for Discord and website access
