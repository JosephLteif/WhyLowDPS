# Changelog

All notable changes to WhyLowDPS should be documented in this file.

The format is based on Keep a Changelog and this project uses semantic versioning for stable releases.

## [Unreleased]

### Added

- Repository governance and maintenance docs:
  - `LICENSE`
  - `CONTRIBUTING.md`
  - `SECURITY.md`
  - `CODE_OF_CONDUCT.md`
  - `ROADMAP.md`

### Fixed

- Sidebar now shows `Settings` by default so users do not have to re-add it manually.
- The in-app changelog popup no longer blocks the Windows title bar controls or window dragging while it is open.
- Raid buff source badges now explain `Override`, `Manual`, and `Default` on hover.

## [3.0.1] - 2026-05-19

### Changed

- Release workflow now generates structured release notes with:
  - recommended download
  - SHA256 checksums for every attached asset
  - explicit Windows/SmartScreen/Battle.net credential notes

### Added

- First-launch Discord invite popup with local dismiss persistence
- Sidebar quick links for Discord and website access
