# Development

## Prerequisites

- **Rust** toolchain (stable)
- **Node.js** 20+
- **Docker** (optional, for game data fetching)

## Web Development

### Without Docker

```bash
# Terminal 1 — Backend
cd backend && cargo run -p simhammer-server

# Terminal 2 — Frontend
cd frontend && npm install && npm run dev
```

Create `frontend/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

- Frontend: http://localhost:3000
- API: http://localhost:8000

Game data and SimC binary must be in `backend/resources/`. See [Self-Hosting](self-hosting.md) for how the data is fetched.

### With Docker

```bash
docker compose -f docker-compose.dev.yml up --build
```

Handles everything — compiles Rust, builds SimC, fetches game data, starts frontend.

## Desktop Development

### 1. Install dependencies

```bash
cd frontend && npm install && cd ..
cd desktop && npm install && cd ..
```

### 2. Run

```bash
npm run desktop:dev
```

On first run, this fetches game data from Raidbots and compiles SimC from source (stored in `backend/resources/`). Subsequent runs skip this step.

This starts:
1. Rust backend (debug mode, port 17384)
2. Next.js dev server (port 3000)
3. Electron app

To re-fetch after a game patch, delete `backend/resources/data/` and/or `backend/resources/simc/`.

### Build Installer

```bash
npm run desktop:build
```

Output goes to `desktop/dist/`.

## Code Quality

All checks run in CI on every PR:

| Tool | Scope | Command |
|------|-------|---------|
| Prettier | Frontend formatting | `cd frontend && npx prettier --check "src/**/*.{ts,tsx,css}"` |
| ESLint | Frontend linting | `cd frontend && npm run lint` |
| cargo fmt | Backend formatting | `cd backend && cargo fmt --all -- --check` |
| Clippy | Backend linting | `cd backend && cargo clippy --all-targets --all-features -- -D warnings` |

Run all locally before pushing:
```bash
cd frontend && npx prettier --write "src/**/*.{ts,tsx,css}" && npm run lint
cd ../backend && cargo fmt --all && cargo clippy --all-targets --all-features -- -D warnings
```
