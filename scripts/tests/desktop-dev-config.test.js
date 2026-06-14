const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

test("desktop dev uses a dedicated frontend port instead of localhost:3000", () => {
  const tauriConfig = readJson("desktop/src-tauri/tauri.conf.json");
  const frontendPackage = readJson("frontend/package.json");

  const devUrl = new URL(tauriConfig.build.devUrl);
  const desktopDevScript = frontendPackage.scripts["dev:desktop"] || "";

  assert.equal(devUrl.hostname, "127.0.0.1");
  assert.notEqual(devUrl.port, "3000");
  assert.match(desktopDevScript, new RegExp(`--port\\s+${devUrl.port}\\b`));
  assert.match(desktopDevScript, /\bNEXT_PUBLIC_DESKTOP_BUILD=true\b/);
  assert.match(tauriConfig.build.beforeDevCommand, /dev:desktop/);
});
