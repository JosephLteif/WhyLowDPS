# WhyLowDps

SimulationCraft web app + desktop app.

## Monorepo Structure
- **frontend/** — Next.js app (shared by web + desktop)
- **backend/** — Cargo workspace: core library, standalone server binary
- **backend/resources/** — Runtime resources: `data/` (game JSON), `simc/` (binary), `frontend/` (static export)
- **desktop/** — Electron app (main process, preload, build config, scripts)

## Architecture

### Rust Backend (shared)
- **Core library** (`backend/core/`): Actix-web routes, game data, addon parser, profileset generator, result parser, simc runner
- **Storage**: `JobStorage` trait with `MemoryStorage` (desktop) and `SqliteStorage` (web, behind `web` feature flag)
- **Game Data**: Raidbots static JSON files loaded at startup from `backend/resources/data/`

### Desktop
- **Shell** (`desktop/`): Electron app, spawns Rust backend as child process
- **Backend**: `whylowdps-server --desktop` (port 17384, MemoryStorage, localhost only)
- **Frontend**: Same Next.js app (static export for Electron, or dev server in dev mode)
- **Window**: Frameless with custom title bar, uses `-webkit-app-region: drag` + Electron IPC
- **Auto-updater**: `electron-updater` with GitHub Releases
- **Sim**: Runs simc directly as subprocess, all CPU cores

### Web
- **Server** (`backend/server/`): Standalone binary, uses `whylowdps-core` with `web` feature
- **Backend**: Rust + Actix-web (port 8000), SQLite job storage
- **Frontend**: Next.js 14 App Router + TypeScript + Tailwind (port 3000)

## Commands

### Web
```bash
docker compose up          # Docker (from repo root)
# or manually:
cd backend && cargo run -p whylowdps-server
cd frontend && npm run dev
```

### Desktop
```bash
# Development (start frontend dev server first, then Electron)
cd frontend && npm run dev
cd desktop && npm run dev

# Build installer
npm run desktop:build
```

## Cargo Workspace (`backend/`)
```
Cargo.toml          — workspace root (members: core, server)
core/               — whylowdps-core library (features: desktop, web)
server/             — whylowdps-server (standalone binary, features: desktop)
```

## Key Patterns
- Frontend shared between web and desktop via `lib/api.ts` (auto-detects API URL via `window.electronAPI`)
- Desktop detection: `window.electronAPI` in frontend, `html[data-desktop]` CSS attribute
- All item/enchant/gem/bonus data from local JSON files, no Wowhead API calls
- Wowhead tooltips loaded client-side (hover popups only)
- Single Rust backend serves identical API shape for both web and desktop
- `JobStorage` trait abstracts persistence: `MemoryStorage` (desktop), `SqliteStorage` (web)
- Desktop build uses `output: "export"` with `generateStaticParams` placeholder for `/sim/[id]`
- Gold accent color: `#C8992A`

## Pages
- `/` — Landing page with sim type cards
- `/quick-sim` — Quick Sim (DPS + stat weights)
- `/top-gear` — Top Gear (best gear combination)
- `/drop-finder` — Drop Finder (droptimizer)
- `/sim/[id]` — Sim results with real-time progress
