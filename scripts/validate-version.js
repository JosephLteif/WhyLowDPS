const fs = require("node:fs");
const path = require("node:path");

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

function normalizeVersion(value) {
  const match = String(value || "")
    .trim()
    .match(VERSION_PATTERN);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

function readText(rootDir, relativePath, errors) {
  try {
    return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
  } catch (error) {
    errors.push(
      `${relativePath}: unable to read file (${error.code || error.message})`,
    );
    return null;
  }
}

function readJson(rootDir, relativePath, errors) {
  const content = readText(rootDir, relativePath, errors);
  if (content === null) return null;

  try {
    return JSON.parse(content);
  } catch (error) {
    errors.push(`${relativePath}: invalid JSON (${error.message})`);
    return null;
  }
}

function addVersionCheck(errors, label, actual, expected) {
  if (actual !== expected) {
    errors.push(`${label}: expected ${expected}, found ${actual || "missing"}`);
  }
}

function cargoWorkspaceVersion(content) {
  const match = content.match(
    /\[workspace\.package\][\s\S]*?\bversion\s*=\s*"([^"]+)"/,
  );
  return match ? match[1] : null;
}

function validateVersion({ rootDir, expectedVersion }) {
  const version = normalizeVersion(expectedVersion);
  const errors = [];

  if (!version) {
    errors.push(
      `release argument: expected a semantic version such as 3.4.2, found ${expectedVersion || "missing"}`,
    );
    return { version: null, errors };
  }

  const versionFile = readText(rootDir, "VERSION", errors);
  if (versionFile !== null) {
    addVersionCheck(errors, "VERSION", versionFile.trim(), version);
  }

  for (const relativePath of ["package.json", "frontend/package.json"]) {
    const packageJson = readJson(rootDir, relativePath, errors);
    if (packageJson)
      addVersionCheck(errors, relativePath, packageJson.version, version);
  }

  for (const relativePath of [
    "package-lock.json",
    "frontend/package-lock.json",
  ]) {
    const lockfile = readJson(rootDir, relativePath, errors);
    if (!lockfile) continue;

    addVersionCheck(
      errors,
      `${relativePath}.version`,
      lockfile.version,
      version,
    );
    addVersionCheck(
      errors,
      `${relativePath}.packages[\"\"].version`,
      lockfile.packages &&
        lockfile.packages[""] &&
        lockfile.packages[""].version,
      version,
    );
  }

  for (const relativePath of ["Cargo.toml", "backend/Cargo.toml"]) {
    const cargoToml = readText(rootDir, relativePath, errors);
    if (cargoToml !== null) {
      addVersionCheck(
        errors,
        `${relativePath} [workspace.package]`,
        cargoWorkspaceVersion(cargoToml),
        version,
      );
    }
  }

  for (const relativePath of [
    "desktop/src-tauri/tauri.conf.json",
    "desktop/src-tauri/tauri.docker.conf.json",
  ]) {
    const tauriConfig = readJson(rootDir, relativePath, errors);
    if (tauriConfig)
      addVersionCheck(errors, relativePath, tauriConfig.version, version);
  }

  return { version, errors };
}

function cli(argv = process.argv.slice(2)) {
  const expectedVersion = argv[0];
  const result = validateVersion({
    rootDir: path.resolve(__dirname, ".."),
    expectedVersion,
  });

  if (result.errors.length > 0) {
    throw new Error(
      [
        "Release version validation failed:",
        ...result.errors.map((error) => `- ${error}`),
      ].join("\n"),
    );
  }

  console.log(`Release version ${result.version} is synchronized.`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = cli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  cargoWorkspaceVersion,
  normalizeVersion,
  validateVersion,
};
