const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const SCRIPT_PATH = path.resolve(__dirname, "../validate-version.js");
const { validateVersion } = require("../validate-version.js");

function writeJson(rootDir, relativePath, value) {
  const filePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFixture({ frontendVersion = "3.4.2" } = {}) {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "validate-version-test-"),
  );
  fs.writeFileSync(path.join(rootDir, "VERSION"), "3.4.2\n");
  writeJson(rootDir, "package.json", { version: "3.4.2" });
  writeJson(rootDir, "package-lock.json", {
    version: "3.4.2",
    packages: { "": { version: "3.4.2" } },
  });
  writeJson(rootDir, "frontend/package.json", { version: frontendVersion });
  writeJson(rootDir, "frontend/package-lock.json", {
    version: frontendVersion,
    packages: { "": { version: frontendVersion } },
  });
  fs.writeFileSync(
    path.join(rootDir, "Cargo.toml"),
    '[workspace.package]\nversion = "3.4.2"\n',
  );
  fs.mkdirSync(path.join(rootDir, "backend"), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, "backend/Cargo.toml"),
    '[workspace.package]\nversion = "3.4.2"\n',
  );
  writeJson(rootDir, "desktop/src-tauri/tauri.conf.json", { version: "3.4.2" });
  writeJson(rootDir, "desktop/src-tauri/tauri.docker.conf.json", {
    version: "3.4.2",
  });
  return rootDir;
}

test("validateVersion accepts the repository's synchronized version", () => {
  const repositoryVersion = fs
    .readFileSync(path.join(ROOT, "VERSION"), "utf8")
    .trim();
  const result = validateVersion({
    rootDir: ROOT,
    expectedVersion: `v${repositoryVersion}`,
  });

  assert.equal(result.version, repositoryVersion);
  assert.deepEqual(result.errors, []);
});

test("validateVersion reports an expected-version mismatch", () => {
  const result = validateVersion({ rootDir: ROOT, expectedVersion: "3.4.3" });

  assert.equal(result.version, "3.4.3");
  assert.ok(result.errors.some((error) => error.includes("VERSION")));
});

test("validateVersion reports drift in a synchronized package file", () => {
  const rootDir = writeFixture({ frontendVersion: "3.4.1" });

  const result = validateVersion({ rootDir, expectedVersion: "3.4.2" });

  assert.ok(
    result.errors.some((error) => error.includes("frontend/package.json")),
  );
});

test("validateVersion reports missing release metadata", () => {
  const rootDir = writeFixture();
  fs.rmSync(path.join(rootDir, "desktop/src-tauri/tauri.docker.conf.json"));

  const result = validateVersion({ rootDir, expectedVersion: "3.4.2" });

  assert.ok(
    result.errors.some((error) =>
      error.includes(
        "desktop/src-tauri/tauri.docker.conf.json: unable to read file",
      ),
    ),
  );
});

test("the CLI exits nonzero for an invalid release version", () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, "3.4.3"], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(
    `${result.stdout}${result.stderr}`,
    /Release version validation failed/,
  );
});
