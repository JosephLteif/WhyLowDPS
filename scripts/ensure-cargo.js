const { spawnSync } = require('child_process');

const check = spawnSync('cargo', ['--version'], {
  stdio: 'pipe',
  shell: process.platform === 'win32',
});

if (check.status === 0) {
  process.exit(0);
}

console.error('[ensure:cargo] Rust toolchain not found (cargo is missing).');
console.error('[ensure:cargo] Install Rust via https://rustup.rs/ and restart your terminal.');
process.exit(1);

