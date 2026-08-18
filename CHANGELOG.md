# Changelog

All notable changes to WhyLowDPS should be documented in this file.

The format is based on Keep a Changelog and this project uses semantic versioning for stable releases.

## [Unreleased]

### Added

- Hosted Light mode now supports simulations, shared game-data catalogs, results, and raid expansion browsing without a Battle.net session; account-specific features remain protected.
- Installable PWA support for the hosted web app, including a manifest, service worker, offline shell, update prompt, and install guidance for native browser prompts, browser menus, and iOS.
- Private, single-instance Docker hosting with an amd64 Compose deployment, prebuilt GHCR images, and a persistent data volume for repeatable upgrades and rollbacks.
- Optional LAN sharing for phones on the same trusted private network, with one-time QR/link pairing, persistent paired-device management, presence tracking, and restart invalidation.

### Changed

- The hosted Raids page now lists cataloged expansions, fills missing current-expansion metadata, and uses public artwork fallbacks when image endpoints have no source.
- Docker hosting documentation derives the web origin and Battle.net callback from the machine's current LAN or DNS host instead of a fixed example IP.
- Tagged releases now health-check and publish versioned, minor, and stable Docker images, then attach hosting configuration, documentation, checksums, and the image digest.
- Hosted deployments use configurable HTTPS Battle.net callback and web-origin settings, while game-data and SimulationCraft runtime refreshes validate staged data and retain the last-known-good state during degraded season rollovers.
