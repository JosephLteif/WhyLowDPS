const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const frontendDir = path.join(repoRoot, 'frontend');
const nextCmd = path.join(frontendDir, 'node_modules', '.bin', process.platform === 'win32' ? 'next.cmd' : 'next');

if (fs.existsSync(nextCmd)) {
  process.exit(0);
}

console.log('[ensure:frontend] Installing frontend dependencies...');

const hasLockfile = fs.existsSync(path.join(frontendDir, 'package-lock.json'));
const npmArgs = hasLockfile ? ['ci'] : ['install'];
const result = spawnSync('npm', npmArgs, {
  cwd: frontendDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}

