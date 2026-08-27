# Changelog

All notable changes to WhyLowDPS should be documented in this file.

The format is based on Keep a Changelog and this project uses semantic versioning for stable releases.

## [Unreleased]

### Changed

- Active simulations now remain monitorable across pages with a minimizable progress indicator, while the duplicate indicator is hidden on the simulation's own progress or result page; completion notifications still link back to the result.
- The release pipeline now separates automated developer builds from stable release promotion for a cleaner, more reliable release cycle.

### Fixed

- Top Gear now keeps the combination count accurate when selecting all available gear items.

## [4.1.1] - 2026-08-25

### Fixed

- Drop Finder item icons now use reliable fallback sources when a game icon endpoint is unavailable.
- Wowhead loot tooltips now use the selected difficulty and upgrade level, keeping displayed item levels and stats aligned with the card.

## [4.1.0] - 2026-08-24

### Added

- Guided tours now cover the dashboard, simulation, upgrade, analysis, and loot workflows, with replay controls from the header help button.
- Managed SimC runtime controls now expose weekly and nightly channels, available versions, runtime status, and binary validation before use.
- The public changelog history is now generated and published as a versioned GitHub Pages archive linked from the app.

### Changed

- System Health is now an optional dashboard widget available from Customize, instead of taking a fixed block above the dashboard; detailed diagnostics remain in Settings > Health.

## [4.0.0] - 2026-08-21

### Added

- Multi-user ownership is now the default in desktop and hosted modes: Battle.net users have separate simulations, routes, profiles, history, and browser state, while desktop Light mode remains a persistent device-local guest account.
- Hosted user administration now supports a BattleTag allowlist, administrator/member roles, disabling access, and revoking active sessions.
- Hosted Blizzard application credentials can be added, rotated, selected, or removed at runtime without restarting the deployment.
- Hosted Light mode can now use shared simulations, results, game-data catalogs, and raid browsing without a Battle.net session; account-specific features remain protected.
- Installable PWA support for the hosted web app, including a manifest, service worker, offline shell, update prompt, and install guidance for native browser prompts, browser menus, and iOS.
- Dungeon browsing now keeps the active season first while retaining available historical encounter lists and artwork fallbacks.
- Private, single-instance Docker hosting with an amd64 Compose deployment, prebuilt GHCR images, direct private-LAN access, and a persistent data volume for repeatable upgrades and rollbacks.
- Optional LAN sharing for phones on the same trusted private network, with one-time QR/link pairing, persistent paired-device management, presence tracking, and restart invalidation.

### Changed

- Mobile UI layouts now adapt navigation, action bars, dense results, settings, and dialogs for narrow touch screens, including phone safe-area support and full-height mobile flows where useful.
- Account switching now revokes the current session and starts a fresh Battle.net login; ordinary sessions persist securely across app and server restarts.
- Account actions now live under one avatar menu with the BattleTag, My Characters, Switch account, and Manage Users options; the current admin account is protected from self-disable, sign-out, or role changes.
- The hosted Raids page now works in Light mode, lists cataloged expansions, fills missing current-expansion metadata, and chains catalog and public artwork fallbacks when image endpoints have no source.
- Dungeon expansion and season selectors retain known content during incomplete runtime refreshes, and dungeon cards fall back through catalog and public artwork sources.
- Removing a paired LAN device immediately invalidates its session and redirects that browser to a QR scanner for a new pairing.
- Docker hosting now derives the web origin and Battle.net callback from the address and port used by the instance; health-check and backup scripts verify operations and produce recoverable archives with SHA-256 hashes.
- The public site and hosting guides now explain the desktop, hosted, PWA, and trusted-LAN paths more clearly, with responsive layouts for smaller screens.
- Tagged releases now health-check and publish versioned, minor, and latest Docker images, then attach hosting configuration, documentation, checksums, and image references.
- Hosted deployments use configurable HTTPS Battle.net callback and web-origin settings, while game-data and SimulationCraft runtime refreshes validate staged data and retain the last-known-good state during degraded season rollovers.
- Small workflow improvements now include visible app search with the Ctrl K shortcut, SimC profile persistence and older-patch warnings, hosted SimC channel and update controls, and clearer account, dungeon, setup, PWA, LAN, and Docker flows.

### Fixed

- Dungeon and Mythic+ route inputs are no longer parsed as character imports when they also contain name-like lines.
- Fixed related-scenario refresh loops, forced fresh Battle.net account selection when switching users, and improved persistence and publication reliability for hosted Docker secrets and images.
