# Changelog

All notable changes to WhyLowDPS should be documented in this file.

The format is based on Keep a Changelog and this project uses semantic versioning for stable releases.

## [Unreleased]

### Added

- Multi-user ownership is now the default in desktop and hosted modes: Battle.net users have separate simulations, routes, profiles, history, and browser state, while desktop Light mode remains a persistent device-local guest account.
- Hosted user administration now supports a BattleTag allowlist, administrator/member roles, disabling access, and revoking active sessions.
- Hosted Blizzard application credentials can be added, rotated, selected, or removed at runtime without restarting the deployment.
- Installable PWA support for the hosted web app, including a manifest, service worker, offline shell, update prompt, and install guidance for native browser prompts, browser menus, and iOS.
- Private, single-instance Docker hosting with an amd64 Compose deployment, prebuilt GHCR images, and a persistent data volume for repeatable upgrades and rollbacks.
- Optional LAN sharing for phones on the same trusted private network, with one-time QR/link pairing, persistent paired-device management, presence tracking, and restart invalidation.

### Changed

- Account switching now revokes the current session and starts a fresh Battle.net login; ordinary sessions persist securely across app and server restarts.
- The hosted Raids page now lists cataloged expansions, fills missing current-expansion metadata, and uses public artwork fallbacks when image endpoints have no source.
- Docker hosting documentation derives the web origin and Battle.net callback from the machine's current LAN or DNS host instead of a fixed example IP.
- Tagged releases now health-check and publish versioned, minor, and stable Docker images, then attach hosting configuration, documentation, checksums, and the image digest.
- Hosted deployments use configurable HTTPS Battle.net callback and web-origin settings, while game-data and SimulationCraft runtime refreshes validate staged data and retain the last-known-good state during degraded season rollovers.
