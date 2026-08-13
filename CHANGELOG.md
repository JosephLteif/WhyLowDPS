# Changelog

All notable changes to WhyLowDPS should be documented in this file.

The format is based on Keep a Changelog and this project uses semantic versioning for stable releases.

## [Unreleased]

### Added

- Setup checklist for game data, Blizzard access, SimC profiles, and first simulations.
- Shared active-character context across the dashboard and simulation workspace.
- Named local simulation presets for recurring SimC setups.

### Fixed

- Existing tracked-character and last-used-character preferences are migrated automatically.
- Setup status is visible without requiring users to hunt through separate settings panels.
- Simulation inputs can be rerun directly, and two history records can be compared side by side.

## [3.0.1] - 2026-05-19

### Changed

- Release workflow now generates structured release notes with:
  - recommended download
  - SHA256 checksums for every attached asset
  - explicit Windows/SmartScreen/Battle.net credential notes

### Added

- First-launch Discord invite popup with local dismiss persistence
- Sidebar quick links for Discord and website access
