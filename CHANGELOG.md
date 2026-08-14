# Changelog

All notable changes to WhyLowDPS should be documented in this file.

The format is based on Keep a Changelog and this project uses semantic versioning for stable releases.

## [Unreleased]

### Added

- Rich Discord Presence with a branded icon, workflow labels for Dashboard, Quick Sim, Top Gear, Drop Finder, History, and simulation results, plus active-character and session context.
- Setup checklist for game data, Blizzard access, SimC profiles, and first simulations.
- Shared active-character context across the dashboard and simulation workspace.
- Accessible `Ctrl+K`/`Cmd+K` command palette for common workflows and direct Settings repair areas.

### Fixed

- Existing tracked-character and last-used-character preferences are migrated automatically.
- Setup status is visible without requiring users to hunt through separate settings panels.
- Simulation inputs can be rerun directly, and two history records can be compared side by side.
- Desktop notifications now keep a clickable in-app result action for completed simulations.
- Desktop launches accept `.simc` and text files through file associations, drag-and-drop, and second-instance handoff.
- Desktop users can export and restore a versioned local backup of simulation data, profiles, routes, and safe UI preferences.
- Backup restore validates the archive, excludes credentials/tokens/cache/runtime binaries, preserves a recovery copy, and restarts safely.
- Settings now provides a quick-repair overview, URL-addressable sections, clearer feedback semantics, and improved keyboard focus states.

## [3.0.1] - 2026-05-19

### Changed

- Release workflow now generates structured release notes with:
  - recommended download
  - SHA256 checksums for every attached asset
  - explicit Windows/SmartScreen/Battle.net credential notes

### Added

- First-launch Discord invite popup with local dismiss persistence
- Sidebar quick links for Discord and website access
