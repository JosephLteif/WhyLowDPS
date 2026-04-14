# Contributing to WhyLowDps

## Architecture Overview

WhyLowDps is a monorepo with two deployment modes sharing one codebase:

```
┌─────────────────────────────────────────────────────┐
│                    Next.js Frontend                 │
│              (shared by both modes)                 │
└──────────────────────┬──────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
       Web                         Desktop
   (port 8000)                  (port 17384)
        │                             │
   Rust/Actix                    Rust/Actix
        │                             │
  SQLite/Postgres               MemoryStorage
        │                             │
       simc                          simc
```

### Project Structure

```
frontend/                Next.js app (shared by web + desktop)
backend/                 Cargo workspace (Rust)
  core/                  whylowdps-core library (API, simc runner, game data)
  server/                whylowdps-server binary (--desktop flag for desktop mode)
  resources/             Runtime resources (data/, simc/, frontend/) — gitignored
desktop/                 Tauri app (main process, tauri.conf.json, build scripts)
docker-compose.dev.yml   Web dev setup (frontend + backend + postgres)
```

### Rust Backend

The core library (`whylowdps-core`) provides:

- **Actix-web routes** — all API endpoints
- **Addon parser** — parses SimC addon export strings
- **Gear resolver** — resolves items with enrichment from the item DB
- **Profileset generator** — builds SimC profileset input for Top Gear, Droptimizer, Upgrade Compare
- **Result parser** — extracts DPS, abilities, stat weights from SimC JSON output
- **SimC runner** — spawns simc as a subprocess with staged execution
- **Game data** — loads Raidbots JSON files (items, enchants, bonuses, instances, upgrade tracks)
- **Storage** — `JobStorage` trait with `SqliteStorage` (desktop & web), `PostgresStorage` (web), and `MemoryStorage` (fallback)

#### Key Patterns

- Frontend shared between web and desktop via `lib/api.ts` (auto-detects API URL via `window.__TAURI__` or `NEXT_PUBLIC_DESKTOP_BUILD`)
- Desktop detection: `NEXT_PUBLIC_DESKTOP_BUILD` or `window.__TAURI__` in frontend
- All item/enchant/gem/bonus data from local JSON files, no external API calls at runtime
- Wowhead tooltips loaded client-side (hover popups only)
- Single Rust backend serves identical API shape for both web and desktop
- Build-time asset caching: instance images and faction crests downloaded during compaction

### Blizzard API Integration

WhyLowDps performs direct Blizzard API integration. It can be configured in two modes:

1. **System Credentials (Local/Desktop)**: Provide your own Client ID and Client Secret in the app settings. The local backend will use these keys to fetch character data, season information, and mythic rotation directly from Blizzard.
2. **User OAuth**: Users can link their Battle.net account to fetch their personal characters. This requires providing Client ID/Secret to the app first.

Instance images and faction assets are fetched at **build time** and served locally — no runtime CDN dependency.

## Development Setup

### Prerequisites

- **Rust** toolchain (stable)
- **Node.js** 20+
- **Docker** (optional, for game data fetching)

### Web Development

#### Without Docker

```bash
# Terminal 1 — Backend
cd backend && cargo run -p whylowdps-server

# Terminal 2 — Frontend
cd frontend && npm install && npm run dev
```

Create `frontend/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

- Frontend: http://localhost:3000
- API: http://localhost:8000

Game data and SimC binary must be in `backend/resources/`.

#### With Docker

```bash
docker compose up --build
```

Handles everything — compiles Rust, builds SimC, fetches game data, starts frontend.

### Desktop Development

#### 1. Install dependencies

```bash
cd frontend && npm install && cd ..
cd desktop && npm install && cd ..
```

#### 2. Run

```bash
npm run desktop:dev
```

On first run, this fetches game data from Raidbots and compiles SimC from source (stored in `backend/resources/`). Subsequent runs skip this step.

This starts:
1. Rust backend (debug mode, port 17384)
2. Next.js dev server (port 3000)
3. Tauri app

To re-fetch after a game patch, delete `backend/resources/data/` and/or `backend/resources/simc/`.

#### Build Installer

```bash
npm run desktop:build
```

Output goes to `desktop/dist/`.

## Code Style & Pull Request Guidelines

- **One concern per PR.** Don't mix features, bug fixes, and refactors in a single PR.
- **No formatting-only changes in functional PRs.** If code needs reformatting, do it in a separate commit or PR. This keeps diffs reviewable.
- **Keep PRs small.** Smaller PRs get reviewed faster and are less likely to introduce bugs.

### Code Quality & CI Checks

All PRs to `master` and `dev` run automated checks. Fix any failures locally before pushing:

| Tool | Scope | Command |
|------|-------|---------|
| Prettier | Frontend formatting | `cd frontend && npx prettier --write "src/**/*.{ts,tsx,css}"` |
| ESLint | Frontend linting | `cd frontend && npm run lint` |
| cargo fmt | Backend formatting | `cd backend && cargo fmt --all` |
| Clippy | Backend linting | `cd backend && cargo clippy --all-targets --all-features -- -D warnings` |

```bash
# Run all checks locally:
cd frontend && npx prettier --write "src/**/*.{ts,tsx,css}" && npm run lint
cd ../backend && cargo fmt --all && cargo clippy --all-targets --all-features -- -D warnings
```
