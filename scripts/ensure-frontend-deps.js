const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

const repoRoot = path.resolve(__dirname, '..');
const frontendDir = path.join(repoRoot, 'frontend');
const nextCmd = path.join(frontendDir, 'node_modules', '.bin', process.platform === 'win32' ? 'next.cmd' : 'next');
const packageJsonPath = path.join(frontendDir, 'package.json');
const packageLockPath = path.join(frontendDir, 'package-lock.json');
const installStampPath = path.join(frontendDir, 'node_modules', '.deps-install-stamp');

function getDependencyStateHash() {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(packageJsonPath));
  if (fs.existsSync(packageLockPath)) {
    hash.update(fs.readFileSync(packageLockPath));
  }
  return hash.digest('hex');
}

function hasFreshFrontendInstall() {
  if (!fs.existsSync(nextCmd) || !fs.existsSync(installStampPath)) {
    return false;
  }

  try {
    const currentHash = getDependencyStateHash();
    const installedHash = fs.readFileSync(installStampPath, 'utf8').trim();
    return currentHash === installedHash;
  } catch {
    return false;
  }
}

if (hasFreshFrontendInstall()) {
  process.exit(0);
}

console.log('[ensure:frontend] Installing frontend dependencies...');

const hasLockfile = fs.existsSync(packageLockPath);
const npmArgs = hasLockfile ? ['ci'] : ['install'];
const result = spawnSync('npm', npmArgs, {
  cwd: frontendDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}

fs.writeFileSync(installStampPath, getDependencyStateHash());
