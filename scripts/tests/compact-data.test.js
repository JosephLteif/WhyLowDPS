const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildCompactManifest, readJson } = require("../../backend/scripts/compact-data.js");

test("buildCompactManifest maps supported compact modes", () => {
  const manifest = buildCompactManifest([
    { local_path: "a.json", compact_mode: "copy" },
    { local_path: "b.json", compact_mode: "fields", compact_fields: ["id", "name"] },
    { local_path: "c.json", compact_mode: "custom_items" },
    { local_path: "d.json", compact_mode: "custom_instances" },
  ]);

  assert.deepEqual(manifest["a.json"], null);
  assert.deepEqual(manifest["b.json"], { fields: ["id", "name"] });
  assert.deepEqual(manifest["c.json"], { custom: true });
  assert.deepEqual(manifest["d.json"], { custom: true, handler: "instances" });
});

test("buildCompactManifest skips unknown modes", () => {
  const manifest = buildCompactManifest([
    { local_path: "known.json", compact_mode: "copy" },
    { local_path: "unknown.json", compact_mode: "mystery-mode" },
  ]);
  assert.deepEqual(Object.keys(manifest), ["known.json"]);
});

test("readJson throws descriptive error for HTML responses", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "compact-data-test-"));
  const filePath = path.join(dir, "bad.json");
  fs.writeFileSync(filePath, "<html><body>404</body></html>");
  assert.throws(() => readJson(filePath), /XML\/HTML, not JSON/);
});

test("readJson throws descriptive error for malformed JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "compact-data-test-"));
  const filePath = path.join(dir, "bad.json");
  fs.writeFileSync(filePath, "{not-json");
  assert.throws(() => readJson(filePath), /Failed to parse/);
});
