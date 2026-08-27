# What's New History

This is the append-only archive for the public GitHub Pages changelog. The app popup intentionally shows only the latest update; older versions remain available on the Pages archive and at their repository release tags.

Add new work under the `Unreleased` section. The release workflow promotes that section to the selected version and date, then the app consumes the synchronized data and the GitHub Pages workflow renders this Markdown file into the published `changelog.html` page.

## Unreleased

### Improvements

#### See the exact combination count before launching

Top Gear and Upgrade Compare now finish calculating the full combination count before a simulation can start, and explain clearly when the total is above the configured launch limit.

- The count continues past the configured limit so the exact total is shown.
- Simulation launch stays disabled while the count is computing or above the limit.
- Over-limit counts show the configured maximum and why the simulation cannot start.

#### Keep simulation progress visible across pages

Active simulations now remain easy to monitor after navigating to another page, with a compact progress card and a completion notification when the result is ready.

- The activity card appears on other pages and can be minimized to a small bottom-right indicator.
- The duplicate activity card is hidden while viewing that simulation's own progress or result page.

#### Rework the release pipeline

The release pipeline now separates automated developer builds from stable release promotion for a cleaner, more reliable release cycle.

- Pushes to `dev` publish the tested moving developer release.
- Stable releases can promote the tested developer build from the Release workflow.

### Bug fixes

#### Show accurate Top Gear combination counts

Selecting all available gear items now keeps the selected item identities aligned with the resolved gear data, so the combination count no longer remains at zero during the selection update.

## v4.1.1 — 2026-08-25 — Release notes for v4.1.1

### Bug fixes

#### Keep loot icons and selected tooltip details in sync

Drop Finder item cards now keep their icons visible through reliable fallback sources, while Wowhead tooltips use the selected difficulty and upgrade level so item levels and stats match the card.

- Show a fallback icon when a primary game icon source is unavailable.
- Refresh tooltip data when the selected difficulty or upgrade level changes.

## v4.1.0 — 2026-08-24 — A clearer, more reliable simulation workspace

### New features

#### Explore the app with guided tours

Page-specific tours now walk you through the dashboard, simulation, upgrade, analysis, and loot workflows when you need a quick orientation.

- Start the current page tour from the help button in the header.
- Tours can follow interactive choices and continue when the next part of a workflow opens.
- Replay a completed tour whenever you want a refresher.

#### Make System Health an optional dashboard widget

System Health no longer takes up a fixed block above the dashboard. Add it only when you want a live readiness summary alongside the other dashboard widgets.

- Open Customize, choose Add Widget, and select System Health when you want the compact readiness summary on the board.
- Drag, resize, or remove the widget like the other dashboard sections; your choice is saved locally.
- Open Settings > Health for detailed diagnostics and repair actions when something needs attention.

### Improvements

#### Choose and monitor the managed SimC runtime

Hosted and desktop runtime controls now expose weekly and nightly channels, available versions, update status, and safer runtime validation.

- Select a SimC channel or a specific available runtime version from Settings > Updates.
- See the active channel and version in the admin sidebar when hosted runtime controls are available.
- Runtime updates validate the downloaded binary and retry incomplete manifest or release metadata before use.

#### Browse the permanent changelog history

The full versioned release archive now lives on the generated GitHub Pages changelog, while the in-app popup stays focused on the latest update.

- Open the archive from View changelog history in the What's New popup.
- Stable releases remain linked to their original GitHub release tags.

#### Keep readiness and runtime updates reliable

Readiness checks, staged data refreshes, managed runtime updates, and release metadata now preserve useful status and the last-known-good state when an update is incomplete.

- See the current SimC channel and version in the admin sidebar when runtime controls are available.
- Retry incomplete manifest or release metadata before activating a managed runtime update.
- Validate runtime binaries before they are used for simulations.

## v4.0.0 — 2026-08-21

### New features

#### Use separate accounts by default

Battle.net users now have separate simulations, routes, profiles, history, and browser state in desktop and hosted mode. Desktop Light mode remains a persistent device-local guest account.

#### Manage hosted users and Blizzard credentials

Hosted deployments can manage access and rotate their Blizzard application credentials without restarting the deployment.

- Configure a BattleTag allowlist and administrator/member roles.
- Disable access or revoke active sessions when needed.
- Add, rotate, select, or remove hosted Blizzard application credentials at runtime.

#### Install WhyLowDPS as a hosted PWA

The hosted web app now includes an installable manifest, service worker, offline shell, update prompt, and browser or iOS installation guidance.

#### Run a private Docker-hosted instance

WhyLowDPS now has a prebuilt amd64 Docker deployment for private, single-instance hosting with a persistent data volume, release image pinning, health checks, and backup scripts.

#### Share the desktop app over your trusted LAN

Desktop Settings can share WhyLowDPS with phones on the same trusted private network through one-time QR/link pairing and persistent paired-device management.

### Improvements

#### Use WhyLowDPS comfortably on mobile

Navigation, action bars, dense results, settings, and dialogs now adapt to smaller touch screens, including phone safe-area support and full-height mobile flows where useful.

#### Make account, dungeon, and release workflows clearer

Account switching, account actions, Light-mode raid browsing, dungeon fallbacks, Docker hosting, release assets, and the public hosting guides now preserve useful state and expose the important next action more clearly.

#### Keep running simulations and hosted data reliable

Progress, profilesets, and statistics use the available page width more effectively. Hosted game-data and SimulationCraft refreshes validate staged data and retain the last-known-good state during degraded season rollovers.

### Bug fixes

#### Keep simulation and account flows on the right route

Dungeon and Mythic+ route inputs are no longer parsed as character imports when they also contain name-like lines. Related-scenario refresh loops, account switching, and hosted Docker persistence are more reliable.

## v3.8.0 — 2026-08-16

### New features

#### Recent character search history

Find recently used characters from the header with filtering and one-click navigation.

#### Pause, resume, and rerun simulations

Control active simulations from the result screen and rerun saved inputs in one click.

#### Shared notification center

Review simulation results and app updates from persistent local notification history.

### Improvements

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
| v4.1.1 | 2026-08-25 | v4.1.0 | 2026-08-24 |
| v4.0.0 | 2026-08-21 | v3.8.0 | 2026-08-16 |
| v3.7.0 | 2026-08-14 | v3.6.0 | 2026-08-13 |
| v3.5.2 | 2026-07-17 | v3.5.1 | 2026-07-17 |
| v3.5.0 | 2026-07-10 | v3.4.2 | 2026-07-07 |
| v3.4.1 | 2026-06-29 | v3.4.0 | 2026-06-23 |
| v3.3.1 | 2026-06-18 | v3.3.0 | 2026-06-16 |
| v3.2.0 | 2026-06-14 | v3.1.2 | 2026-05-25 |
| v3.1.1 | 2026-05-24 | v3.1.0 | 2026-05-19 |
| v3.0.1 | 2026-05-18 | v3.0.0 | 2026-05-18 |
| v2.6.0 | 2026-05-13 | v2.5.4 | 2026-05-12 |
| v2.5.3 | 2026-05-12 | v2.5.2 | 2026-05-11 |
| v2.5.1 | 2026-05-11 | v2.5.0 | 2026-05-11 |
| v2.4.0 | 2026-05-09 | v2.3.1 | 2026-05-08 |
| v2.3.0 | 2026-05-07 | v2.2.0 | 2026-05-06 |
| v2.1.0 | 2026-05-06 | v2.0.0 | 2026-05-05 |
| v1.8.0 | 2026-05-04 | v1.7.0 | 2026-05-03 |
| v1.6.0 | 2026-05-01 | v1.5.1 | 2026-04-29 |
| v1.5.0 | 2026-04-29 | v1.4.2 | 2026-04-28 |
| v1.4.1 | 2026-04-28 | v1.4.0 | 2026-04-28 |
| v1.3.1 | 2026-04-23 | v1.3.0 | 2026-04-23 |
| v1.2.4 | 2026-04-22 | v1.2.3 | 2026-04-21 |
| v1.2.2 | 2026-04-21 | v1.2.1 | 2026-04-21 |
| v1.2.0 | 2026-04-21 | v1.1.0 | 2026-04-20 |
| v1.0.2 | 2026-04-20 | v1.0.1 | 2026-04-20 |
| v1.0.0 | 2026-04-20 | v0.9.5 | 2026-04-19 |
| v0.9.4 | 2026-04-19 | v0.9.3 | 2026-04-19 |
| v0.9.2 | 2026-04-19 | v0.9.1 | 2026-04-18 |
| v0.9.0 | 2026-04-18 | v0.8.0 | 2026-04-14 |
| v0.7.1 | 2026-04-14 | v0.7.0 | 2026-04-14 |
| v0.6.1 | 2026-04-12 | v0.6.0 | 2026-04-12 |
| v0.5.0 | 2026-04-11 | v0.4.4 | 2026-04-11 |
| v0.4.3 | 2026-04-11 | v0.4.2 | 2026-04-11 |
| v0.4.1 | 2026-04-11 | v0.4.0 | 2026-04-11 |
| v0.3.0 | 2026-04-11 | v0.2.4 | 2026-04-09 |
| v0.2.3 | 2026-04-09 | v0.2.2 | 2026-04-09 |
| v0.2.1 | 2026-04-09 | v0.2.0 | 2026-04-09 |
| v0.1.0 | 2026-04-09 |  |  |
