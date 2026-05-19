# Contributing to WhyLowDPS

Thanks for your interest in contributing.

## Scope

WhyLowDPS is currently Windows-first and desktop-first. Please keep changes focused, practical, and aligned with existing architecture and UX patterns.

## Before you start

- Open an issue first for non-trivial changes.
- Keep pull requests small and single-purpose.
- Avoid unrelated refactors in feature/bugfix PRs.

## Development

- Node.js 20+
- Rust stable toolchain
- Windows environment for full desktop validation

Install dependencies:

```bash
npm ci
npm ci --prefix frontend
```

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

