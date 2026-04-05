#!/bin/bash
# Reads VERSION file and syncs it to all project manifests.
# Usage: bash scripts/sync-version.sh

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"

echo "Syncing version: $VERSION"

# Cargo workspace
sed -i "s/^version = \".*\"/version = \"$VERSION\"/" "$ROOT/backend/Cargo.toml"

# package.json files
for f in "$ROOT/frontend/package.json" "$ROOT/package.json"; do
    sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" "$f"
done

echo "Done."
