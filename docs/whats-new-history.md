# What's New History

This is the append-only archive for the in-app What's New experience and the public changelog page. The popup intentionally shows only the latest update; older versions remain available here and at their repository release tags.

When a release ships, add a dated version section below and update the structured release data in `frontend/src/app/lib/changelog.ts`. Keep the version, date, category headings, and user-facing wording aligned between both files.

## Unreleased — 2026-08-22

### New features

#### Make System Health an optional dashboard widget

System Health no longer takes up a fixed block above the dashboard. Add it only when you want a live readiness summary alongside the other dashboard widgets.

- Open Customize, choose Add Widget, and select System Health.
- Drag, resize, or remove the widget; the choice is saved locally.
- Open Settings > Health for detailed diagnostics and repair actions.

## v3.8.0 — 2026-08-16

### New features

#### Recent character search history

Find recently used characters from the header with filtering and one-click navigation.

#### Pause, resume, and rerun simulations

Control active simulations from the result screen and rerun saved inputs in one click.

#### Shared notification center

Review simulation results and app updates from persistent local notification history.

#### Get Discord notifications for finished sims

WhyLowDPS can send rich Discord webhook notifications when simulations finish in desktop and Docker-hosted mode.

- Configure the webhook under Settings > Integrations and choose notification categories.
- Notifications include DPS details, fight configuration, runtime information, and upgrade highlights.
- Webhook URLs are stored securely and can be tested, rotated, or removed.

#### Use separate accounts by default

Battle.net users now have separate simulations, routes, profiles, history, and browser state in desktop and hosted mode. Desktop Light mode remains a persistent device-local guest account.

### Improvements

#### Use WhyLowDPS comfortably on mobile

Navigation, action bars, dense results, settings, and dialogs now adapt to smaller touch screens, including phone safe-area support and full-height mobile flows where useful.

#### Run a private Docker-hosted instance

WhyLowDPS now has a prebuilt amd64 Docker deployment for private, single-instance hosting with a persistent data volume, release image pinning, health checks, and backup scripts.

#### Share the desktop app over your trusted LAN

Desktop Settings can share WhyLowDPS with phones on the same trusted private network through one-time QR/link pairing and persistent paired-device management.

#### Clearer running simulation status

Progress, profilesets, and statistics now use the available page width more effectively.

### Bug fixes

#### More reliable desktop notifications

Completed simulation notifications are deduplicated and keep their in-app result action. App updates are recorded in notification history while the existing updater remains the live install flow.

## v3.7.0 — 2026-08-14

### New features

#### Setup checklist and command palette

Get a guided setup status and direct access to common workflows and repair areas.

#### Shared active-character context

Keep the active character consistent between the dashboard and simulation workspace.

### Improvements

#### Backup and restore safeguards

Export and restore versioned local simulation data while excluding credentials, tokens, caches, and runtime binaries.

### Bug fixes

#### More reliable desktop file handoff

Desktop launches now accept SimC and text files through associations, drag-and-drop, and second-instance handoff.

#### Clearer setup recovery

Setup status, repair areas, URL-addressable Settings sections, feedback semantics, and keyboard focus states are easier to find and understand.

## v3.6.0 — 2026-08-13

### New features

#### Season-aware Loot Browser

Group loot by expansion, season, and the active dungeon rotation.

#### Resizable Loot Browser instance panel

Resize the instance panel with mouse or keyboard controls.

### Bug fixes

#### More stable historical dungeon views

Active dungeons stay in the active group, source-expansion links remain available, current-season item-level controls are preserved, and incomplete metadata uses trusted fallbacks.

## v3.5.2 — 2026-07-17

### Documentation

#### Repository governance documentation

Added the project license, contribution guide, security policy, code of conduct, and roadmap.

### Improvements

#### Clearer raid-buff source badges

Hover explanations now clarify Override, Manual, and Default sources.

### Bug fixes

#### A less disruptive What's New popup

The in-app changelog no longer blocks Windows title-bar controls or window dragging.

## v3.0.1 — 2026-05-18

### Improvements

#### Structured release notes and downloads

Release artifacts include a recommended download, SHA256 checksums, and explicit Windows, SmartScreen, and Battle.net credential notes.

### New features

#### Discord invite and quick links

A first-launch Discord invite and sidebar links make community access easier.

## Release index

These stable tags are preserved in the repository. Releases whose detailed notes have not yet been migrated into the sections above remain selectable in the changelog page and link to their original release tag.

| Version | Tagged | Version | Tagged |
| --- | --- | --- | --- |
| v3.8.0 | 2026-08-16 | v3.7.0 | 2026-08-14 |
| v3.6.0 | 2026-08-13 | v3.5.2 | 2026-07-17 |
| v3.5.1 | 2026-07-17 | v3.5.0 | 2026-07-10 |
| v3.4.2 | 2026-07-07 | v3.4.1 | 2026-06-29 |
| v3.4.0 | 2026-06-23 | v3.3.1 | 2026-06-18 |
| v3.3.0 | 2026-06-16 | v3.2.0 | 2026-06-14 |
| v3.1.2 | 2026-05-25 | v3.1.1 | 2026-05-24 |
| v3.1.0 | 2026-05-19 | v3.0.1 | 2026-05-18 |
| v3.0.0 | 2026-05-18 | v2.6.0 | 2026-05-13 |
| v2.5.4 | 2026-05-12 | v2.5.3 | 2026-05-12 |
| v2.5.2 | 2026-05-11 | v2.5.1 | 2026-05-11 |
| v2.5.0 | 2026-05-11 | v2.4.0 | 2026-05-09 |
| v2.3.1 | 2026-05-08 | v2.3.0 | 2026-05-07 |
| v2.2.0 | 2026-05-06 | v2.1.0 | 2026-05-06 |
| v2.0.0 | 2026-05-05 | v1.8.0 | 2026-05-04 |
| v1.7.0 | 2026-05-03 | v1.6.0 | 2026-05-01 |
| v1.5.1 | 2026-04-29 | v1.5.0 | 2026-04-29 |
| v1.4.2 | 2026-04-28 | v1.4.1 | 2026-04-28 |
| v1.4.0 | 2026-04-28 | v1.3.1 | 2026-04-23 |
| v1.3.0 | 2026-04-23 | v1.2.4 | 2026-04-22 |
| v1.2.3 | 2026-04-21 | v1.2.2 | 2026-04-21 |
| v1.2.1 | 2026-04-21 | v1.2.0 | 2026-04-21 |
| v1.1.0 | 2026-04-20 | v1.0.2 | 2026-04-20 |
| v1.0.1 | 2026-04-20 | v1.0.0 | 2026-04-20 |
| v0.9.5 | 2026-04-19 | v0.9.4 | 2026-04-19 |
| v0.9.3 | 2026-04-19 | v0.9.2 | 2026-04-19 |
| v0.9.1 | 2026-04-18 | v0.9.0 | 2026-04-18 |
| v0.8.0 | 2026-04-14 | v0.7.1 | 2026-04-14 |
| v0.7.0 | 2026-04-14 | v0.6.1 | 2026-04-12 |
| v0.6.0 | 2026-04-12 | v0.5.0 | 2026-04-11 |
| v0.4.4 | 2026-04-11 | v0.4.3 | 2026-04-11 |
| v0.4.2 | 2026-04-11 | v0.4.1 | 2026-04-11 |
| v0.4.0 | 2026-04-11 | v0.3.0 | 2026-04-11 |
| v0.2.4 | 2026-04-09 | v0.2.3 | 2026-04-09 |
| v0.2.2 | 2026-04-09 | v0.2.1 | 2026-04-09 |
| v0.2.0 | 2026-04-09 | v0.1.0 | 2026-04-09 |
