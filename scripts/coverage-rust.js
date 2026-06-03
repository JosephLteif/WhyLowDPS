const { spawnSync } = require("node:child_process");

function run(args) {
  return spawnSync("cargo", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

const versionCheck = run(["llvm-cov", "--version"]);
if (versionCheck.status !== 0) {
  console.error("\nRust coverage requires cargo-llvm-cov.");
  console.error("Install it once with:");
  console.error("  cargo install cargo-llvm-cov");
  process.exit(versionCheck.status || 1);
}

const ignoreMainRegex = String.raw`desktop[\\/]+src-tauri[\\/]+src[\\/]+main\.rs`;

const coverageRun = run([
  "llvm-cov",
  "--workspace",
  "--all-features",
  "--summary-only",
  "--ignore-filename-regex",
  ignoreMainRegex,
]);

process.exit(coverageRun.status || 0);
