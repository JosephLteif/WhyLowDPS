# Repository Guidelines

## Project Structure & Module Organization

- `frontend/` contains the Next.js application. Routes and UI components live under `frontend/src/app/`; shared parsing
  and utilities are in `frontend/src/lib/`. Browser tests are in `frontend/e2e/`, and unit/component tests are colocated
  as `*.test.ts` or `*.test.tsx`.
- `backend/core/` contains domain logic and data handling; `backend/server/` contains the Rust HTTP server. Static game
  data and manifests are in `backend/resources/`.
- `desktop/src-tauri/` contains the Tauri desktop shell and native Rust integration.
- `scripts/` contains release, data, and validation tooling; its tests are in `scripts/tests/`. User and hosting
  documentation is in `docs/`.

## Build, Test, and Development Commands

Install dependencies with `npm ci` and `npm ci --prefix frontend`. Run the desktop app with `npm run desktop:dev`. For
browser/LAN development, run `npm run backend:dev` and `npm run web:dev:lan` in separate terminals.

Use `npm run check` for the aggregate typecheck, lint, and test suite. Focused checks are `npm run typecheck:frontend`,
`npm run test:frontend`, `npm run test:scripts`, and `cargo test --workspace`. Build the web bundle with
`npm run build:frontend`; validate the desktop build with `npm run tauri:build:check`.

## Coding Style & Naming Conventions

Follow `.editorconfig`: two-space indentation for JavaScript/TypeScript/CSS and four spaces for Rust, with LF line
endings. Frontend formatting uses Prettier (100-column width, semicolons, single quotes, Tailwind sorting); run
`npm run format:check` from `frontend`. ESLint is run with `npm run lint:frontend`. Use PascalCase for React components,
camelCase for TypeScript symbols, and snake_case for Rust modules/functions. Run
`cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check` for desktop Rust changes.

## Testing Guidelines

Vitest covers frontend unit/component tests, Playwright covers end-to-end flows, Node’s built-in test runner covers
repository scripts, and Cargo tests cover Rust crates. Add regression coverage beside the changed code, using
descriptive behavior-focused test names. Run the narrowest relevant test first, then the aggregate checks before
submitting.

## Commit & Pull Request Guidelines

Use short, imperative commit subjects; the history also uses Conventional Commit prefixes such as `docs:` and
`build(deps):`. Keep commits and PRs focused. PR descriptions should explain user impact and validation, link an issue
for non-trivial work, include screenshots for UI changes, and call out risk or rollback considerations.

## Security & Configuration

Keep secrets in local `.env` files and never commit credentials. Preserve the project’s local-first behavior and do not
add remote storage for Battle.net credentials. LAN development is for trusted private networks only; do not expose
development or private-hosting ports publicly.
