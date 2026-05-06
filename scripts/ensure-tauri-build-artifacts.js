const fs = require('fs');
const path = require('path');

function removeDirIfExists(dir) {
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

function cleanTauriBuildArtifacts(repoRoot) {
  const targetBuildDir = path.join(repoRoot, 'target', 'debug', 'build');
  if (!fs.existsSync(targetBuildDir)) return 0;

  let removed = 0;
  for (const entry of fs.readdirSync(targetBuildDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith('tauri-')) continue;
    const full = path.join(targetBuildDir, entry.name);
    if (removeDirIfExists(full)) removed += 1;
  }
  return removed;
}

function main() {
  const repoRoot = process.cwd();
  const removed = cleanTauriBuildArtifacts(repoRoot);
  if (removed > 0) {
    console.log(`Removed ${removed} stale tauri build artifact director${removed === 1 ? 'y' : 'ies'}.`);
  } else {
    console.log('No stale tauri build artifacts found.');
  }
}

main();