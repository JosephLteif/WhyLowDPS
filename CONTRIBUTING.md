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
20 and Rust 1.95; the repository includes `.nvmrc` and `rust-toolchain.toml`
so local tools and CI use the same versions.

Windows is required for full desktop validation. GitHub Pages is the only
supported deployment target outside the desktop application.

Install dependencies:

```bash
npm ci
npm ci --prefix frontend
```

Sync a local work branch to the latest release commit before continuing work:

```bash
git fetch origin master --tags
git merge --ff-only origin/master
```

The release action commits synchronized version metadata to `master` before it
creates the release tag. Keep local changes committed or stashed before this
fast-forward.

Run the desktop app:

```bash
npm run desktop:dev
```

Run the backend directly:

```bash
cd backend
cargo run -p whylowdps-server
```

Run the development frontend for a phone on the same LAN:

```bash
# Terminal 1, from the repository root
npm run backend:dev

# Terminal 2, from the repository root
npm run web:dev:lan
```

Find the PC's private IPv4 address with `ipconfig`, then open
`http://<PC-LAN-IP>:3000` on the phone. Both devices must be on the same trusted
Wi-Fi network. If Windows Firewall prompts, allow Node.js on **Private
networks**; do not enable a Public-network rule or forward the port to the
internet. The Next.js development server is the LAN-facing process and keeps
the backend on `127.0.0.1:8000`.

For an installed desktop build, enable **Settings > Simulation > Share over
LAN**, restart WhyLowDPS, and create a phone link. Scan the displayed QR code
with the phone camera or copy the URL manually. The link is one-time and
expires after five minutes. It grants access to the local app using the PC's
current account session, so share it only with someone on the trusted private
network. Turn the setting off and restart the app to return to loopback-only
behavior.

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
