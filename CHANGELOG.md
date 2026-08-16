# Changelog

All notable changes to WhyLowDPS should be documented in this file.

The format is based on Keep a Changelog and this project uses semantic versioning for stable releases.

## [Unreleased]

### Added

- Shared notification center with persistent local history, unread counts, read-state controls, and direct actions for simulation results and app updates.
- One-click reruns that submit the saved simulation input directly and open the new result.

### Changed

- Running simulation status now uses the available page width with clearer profileset progress and stats grouping.

### Fixed

- Desktop simulation notifications are deduplicated and keep a clickable in-app result action for completed simulations.
- App updates are recorded in notification history while the existing updater popup remains the single live install and restart flow.

## [3.0.1] - 2026-05-19

### Changed

- Release workflow now generates structured release notes with:
  - recommended download
  - SHA256 checksums for every attached asset
  - explicit Windows/SmartScreen/Battle.net credential notes

### Added

- First-launch Discord invite popup with local dismiss persistence
- Sidebar quick links for Discord and website access
