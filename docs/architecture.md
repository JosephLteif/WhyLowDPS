# Architecture

## Overview

WhyLowDps is a monorepo with three deployment modes sharing one codebase:

```
┌─────────────────────────────────────────────────────┐
│                    Next.js Frontend                  │
│              (shared by all three modes)             │
└──────────────────────┬──────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   Standalone        Web          Desktop
   (port 8000)    (port 8000)   (port 17384)
        │              │              │
   Rust/Actix     Rust/Actix     Rust/Actix
        │              │              │
     SQLite      SQLite/Postgres  MemoryStorage
        │              │              │
       simc           simc          simc
```

## Project Structure

```
frontend/                Next.js app (shared by web + desktop)
backend/                 Cargo workspace (Rust)
  core/                  whylowdps-core library (API, simc runner, game data)
  server/                whylowdps-server binary (--desktop flag for desktop mode)
  resources/             Runtime resources (data/, simc/, frontend/) — gitignored
desktop/                 Electron app (main process, preload, build scripts)
docker-compose.dev.yml   Web dev setup (frontend + backend + postgres)
Dockerfile.standalone    Single-image build (frontend + backend)
```

## Rust Backend

The core library (`whylowdps-core`) provides:

- **Actix-web routes** — all API endpoints
- **Addon parser** — parses SimC addon export strings
- **Gear resolver** — resolves items with enrichment from the item DB
- **Profileset generator** — builds SimC profileset input for Top Gear, Droptimizer, Upgrade Compare
- **Result parser** — extracts DPS, abilities, stat weights from SimC JSON output
- **SimC runner** — spawns simc as a subprocess with staged execution
- **Game data** — loads Raidbots JSON files (items, enchants, bonuses, instances, upgrade tracks)
- **Storage** — `JobStorage` trait with `MemoryStorage` (desktop), `SqliteStorage` (web), `PostgresStorage` (web)

### Key Patterns

- Frontend shared between web and desktop via `lib/api.ts` (auto-detects API URL via `window.electronAPI`)
- Desktop detection: `window.electronAPI` in frontend, `html[data-desktop]` CSS attribute
- All item/enchant/gem/bonus data from local JSON files, no external API calls at runtime
- Wowhead tooltips loaded client-side (hover popups only)
- Single Rust backend serves identical API shape for both web and desktop
- Build-time asset caching: instance images and faction crests downloaded during compaction

### Job Retention

Jobs are automatically garbage collected on insert:
- **Desktop**: last 50 sims
- **Web**: last 200 sims

## Blizzard API Integration

WhyLowDps performs direct Blizzard API integration. It can be configured in two modes:

1. **System Credentials (Local/Desktop)**: Provide your own Client ID and Client Secret in the app settings. The local backend will use these keys to fetch character data, season information, and mythic rotation directly from Blizzard.
2. **User OAuth**: Users can link their Battle.net account to fetch their personal characters. This requires providing Client ID/Secret to the app first.

The following routes act as a local proxy to Blizzard APIs (using the configured system or user keys):

| Path | Description | Caching |
|---|---|---|
| `/api/blizzard/character/{realm}/{name}/profile` | Character summary with faction | 15 min |
| `/api/blizzard/character/{realm}/{name}/equipment` | Equipped gear | 15 min |
| `/api/blizzard/character/{realm}/{name}/media/{type}` | Character render/avatar/inset (302 redirect) | 1 hour |
| `/api/season-config` | M+ rotation, season info | Processed locally |
| `/api/instances` | Expansion dungeons + raids with images | Processed locally |


Instance images and faction assets are fetched at **build time** and served locally — no runtime CDN dependency.

## CI/CD

- **Lint** — Prettier, ESLint, cargo fmt, Clippy on every PR
- **Desktop** — GitHub Actions builds Windows, macOS (code signing + notarization), Linux installers on tagged releases
- **Docker** — Published to `ghcr.io/sortbek/simcraft` on push to master (amd64)
