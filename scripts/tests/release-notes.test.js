const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildReleaseNotes,
  chooseRecommendedAsset,
  parseChecksumsFile,
} = require("../release-notes.js");

test("chooseRecommendedAsset prefers exact versioned setup", () => {
  const version = "3.0.1";
  const picked = chooseRecommendedAsset(version, [
    "WhyLowDPS_3.0.1_x64-setup.exe",
    "WhyLowDPS_3.0.1_x64_en-US.msi",
  ]);
  assert.equal(picked, "WhyLowDPS_3.0.1_x64-setup.exe");
});

test("parseChecksumsFile accepts sha256sum style lines", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-notes-test-"));
  const checksumPath = path.join(dir, "checksums.txt");
  fs.writeFileSync(
    checksumPath,
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  WhyLowDPS_3.0.1_x64-setup.exe\n"
  );
  const entries = parseChecksumsFile(checksumPath);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].file, "WhyLowDPS_3.0.1_x64-setup.exe");
  assert.equal(entries[0].hash, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test("buildReleaseNotes renders required sections", () => {
  const notes = buildReleaseNotes({
    version: "3.0.1",
    assetNames: ["WhyLowDPS_3.0.1_x64-setup.exe"],
    checksumEntries: [
      {
        file: "WhyLowDPS_3.0.1_x64-setup.exe",
        hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    ],
  });

  assert.match(notes, /## Download/);
  assert.match(notes, /Recommended: WhyLowDPS_3.0.1_x64-setup\.exe/);
  assert.match(notes, /## Checksums/);
  assert.match(notes, /SHA256:/);
  assert.match(notes, /## Notes/);
  assert.match(notes, /Unsigned build may show SmartScreen warning/);
});
