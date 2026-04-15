# AI Agent Instructions

Welcome to the **WhyLowDps / Simcraft** repository. When assisting with this project, please adhere to the following architecture and guidelines.

## Tech Stack Overview

1. **Frontend**: Next.js (React, TypeScript, Tailwind CSS). Shared by both web and desktop modes.
2. **Backend**: Rust (Actix-Web). Provides REST API endpoints, acts as a wrapper around the `simc` (SimulationCraft) subprocess, and processes static game data.
3. **Desktop**: Tauri. Replaced the previous Electron implementation. The Tauri app bundles the Rust backend as a sidecar or proxy, running the Next.js frontend in the webview.

## Architecture Guidelines

- **Tauri over Electron**: The desktop app is built with Tauri (`desktop/src-tauri`). Do not suggest or write Electron-specific code. Use `@tauri-apps/api` for desktop integrations.
- **Shared Frontend**: The Next.js frontend code is shared between the web application and the Tauri desktop application. Desktop mode is detected via `window.__TAURI__` or the `NEXT_PUBLIC_DESKTOP_BUILD` environment variable.
- **Local Game Data**: All item, enchant, gem, and bonus data are processed from local JSON files. We do not make external API calls for this at runtime.
- **Storage**: The application uses a unified `JobStorage` trait. Both web and desktop versions default to `SqliteStorage`, with `PostgresStorage` available for web deployments. `MemoryStorage` is available as a fallback.

## Common Commands

- **Web (Docker)**: `npm run web:dev` - Runs everything via docker-compose.
- **Desktop (Tauri)**: `npm run desktop:dev` - Starts the Rust backend, Next.js dev server, and Tauri app.
- **Format Code**:
  - Frontend: `cd frontend && npx prettier --write "src/**/*.{ts,tsx,css}"`
  - Backend: `cd backend && cargo fmt --all`
- **Lint Code**:
  - Frontend: `cd frontend && npm run lint`
  - Backend: `cd backend && cargo clippy --all-targets --all-features -- -D warnings`

## Code Rules

- Do not mix features, bug fixes, and refactors in a single PR.
- Keep PRs small and reviewable.
- Do not make formatting-only changes alongside functional changes.
- Avoid introducing new dependencies without justification. Standard libraries and existing dependencies should be preferred.
