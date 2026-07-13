# Contributing to WhyLowDPS

Thanks for your interest in contributing.

## Scope

WhyLowDPS is currently Windows-first and desktop-first. Please keep changes focused, practical, and aligned with existing architecture and UX patterns.

## Before you start

- Open an issue first for non-trivial changes.
- Keep pull requests small and single-purpose.
- Avoid unrelated refactors in feature/bugfix PRs.

## Development

The supported development target is the Windows desktop application. Use Node.js
20 and Rust 1.94.1; the repository includes `.nvmrc` and `rust-toolchain.toml`
so local tools and CI use the same versions.

Windows is required for full desktop validation. GitHub Pages is the only
supported deployment target outside the desktop application.

Install dependencies:

```bash
npm ci
npm ci --prefix frontend
```

Run the desktop app:

```bash
npm run desktop:dev
```

Run the backend directly:

```bash
cd backend
cargo run -p whylowdps-server
```

Run the focused checks used by the repository:

```bash
npm run typecheck:frontend
npm run test:frontend
npm run test:scripts
cargo test --workspace
```

The desktop crate formatting gate is:

```bash
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check
```

The full desktop build check is:

```bash
npm run tauri:build:check
```

## Release workflow

Stable releases are created from `master`. Before tagging, run:

```bash
npm run verify:release -- 3.4.2
```

The release workflow creates a draft GitHub release, uploads the signed
artifacts and checksum metadata, and publishes the release only after those
steps complete. If a release step fails, leave the draft unpublished until the
failure is corrected or the draft is deleted.

## Pull request guidelines

- Use clear commit messages.
- Describe user impact, not only code changes.
- Include screenshots for UI changes.
- Call out risk areas and rollback path for risky changes.
- Ensure local checks relevant to your change pass.

## Trust and privacy expectations

- Do not introduce remote storage of Battle.net credentials.
- Keep local-first behavior intact unless explicitly discussed and approved.
- Document any new network data source in README and release notes.

## Code style

- Follow existing conventions in touched files.
- Prefer minimal, maintainable changes over broad rewrites.
- Keep logic readable and strongly typed.
