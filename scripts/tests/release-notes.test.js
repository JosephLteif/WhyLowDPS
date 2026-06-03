const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT_PATH = path.resolve(__dirname, "../release-notes.js");

const {
  buildReleaseNotes,
  chooseRecommendedAsset,
  parseChecksumsFile,
} = require("../release-notes.js");

const HASH_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HASH_C = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "release-notes-test-"));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

test("chooseRecommendedAsset prefers exact versioned setup", () => {
  assert.equal(
    chooseRecommendedAsset("3.0.1", [
      "WhyLowDPS_3.0.1_x64-setup.exe",
      "WhyLowDPS_3.0.1_x64_en-US.msi",
    ]),
    "WhyLowDPS_3.0.1_x64-setup.exe"
  );
});

test("chooseRecommendedAsset falls back to alphabetically first setup exe", () => {
  assert.equal(
    chooseRecommendedAsset("3.0.1", [
      "z-setup.exe",
      "a-setup.exe",
      "portable.exe",
      "archive.zip",
    ]),
    "a-setup.exe"
  );
});

test("chooseRecommendedAsset falls back to alphabetically first exe", () => {
  assert.equal(
    chooseRecommendedAsset("3.0.1", [
      "z-portable.exe",
      "a-portable.exe",
      "archive.zip",
    ]),
    "a-portable.exe"
  );
});

test("chooseRecommendedAsset falls back to alphabetically first asset", () => {
  assert.equal(
    chooseRecommendedAsset("3.0.1", [
      "z.zip",
      "a.tar.gz",
      "b.msi",
    ]),
    "a.tar.gz"
  );
});

test("chooseRecommendedAsset ignores falsy asset names", () => {
  assert.equal(
    chooseRecommendedAsset("3.0.1", [
      "",
      null,
      undefined,
      "WhyLowDPS_3.0.1_x64-setup.exe",
    ]),
    "WhyLowDPS_3.0.1_x64-setup.exe"
  );
});

test("chooseRecommendedAsset returns empty string for missing or empty asset list", () => {
  assert.equal(chooseRecommendedAsset("3.0.1", []), "");
  assert.equal(chooseRecommendedAsset("3.0.1", null), "");
  assert.equal(chooseRecommendedAsset("3.0.1", undefined), "");
});

test("chooseRecommendedAsset requires exact case-sensitive preferred filename", () => {
  assert.equal(
    chooseRecommendedAsset("3.0.1", [
      "whylowdps_3.0.1_x64-setup.exe",
      "portable.exe",
    ]),
    "whylowdps_3.0.1_x64-setup.exe"
  );
});

test("parseChecksumsFile accepts sha256sum style lines", () => {
  const dir = makeTempDir();
  const checksumPath = path.join(dir, "checksums.txt");

  writeFile(
    checksumPath,
    `${HASH_A}  WhyLowDPS_3.0.1_x64-setup.exe\n`
  );

  assert.deepEqual(parseChecksumsFile(checksumPath), [
    {
      file: "WhyLowDPS_3.0.1_x64-setup.exe",
      hash: HASH_A,
    },
  ]);
});

test("parseChecksumsFile accepts file-first format", () => {
  const dir = makeTempDir();
  const checksumPath = path.join(dir, "checksums.txt");

  writeFile(
    checksumPath,
    `WhyLowDPS_3.0.1_x64-setup.exe  ${HASH_C}\n`
  );

  assert.deepEqual(parseChecksumsFile(checksumPath), [
    {
      file: "WhyLowDPS_3.0.1_x64-setup.exe",
      hash: HASH_C,
    },
  ]);
});

test("parseChecksumsFile accepts whitespace-separated hash-first format", () => {
  const dir = makeTempDir();
  const checksumPath = path.join(dir, "checksums.txt");

  writeFile(
    checksumPath,
    `${HASH_A}\tWhyLowDPS_3.0.1_x64-setup.exe\n`
  );

  assert.deepEqual(parseChecksumsFile(checksumPath), [
    {
      file: "WhyLowDPS_3.0.1_x64-setup.exe",
      hash: HASH_A,
    },
  ]);
});

test("parseChecksumsFile accepts whitespace-separated file-first format", () => {
  const dir = makeTempDir();
  const checksumPath = path.join(dir, "checksums.txt");

  writeFile(
    checksumPath,
    `WhyLowDPS_3.0.1_x64-setup.exe ${HASH_B}\n`
  );

  assert.deepEqual(parseChecksumsFile(checksumPath), [
    {
      file: "WhyLowDPS_3.0.1_x64-setup.exe",
      hash: HASH_B,
    },
  ]);
});

test("parseChecksumsFile lowercases uppercase hashes", () => {
  const dir = makeTempDir();
  const checksumPath = path.join(dir, "checksums.txt");

  writeFile(
    checksumPath,
    `${HASH_A.toUpperCase()}  app.exe\n`
  );

  assert.deepEqual(parseChecksumsFile(checksumPath), [
    {
      file: "app.exe",
      hash: HASH_A,
    },
  ]);
});

test("parseChecksumsFile strips directory paths from filenames", () => {
  const dir = makeTempDir();
  const checksumPath = path.join(dir, "checksums.txt");

  writeFile(
    checksumPath,
    `${HASH_A}  dist/windows/WhyLowDPS.exe\n` +
    `dist/windows/WhyLowDPS.msi  ${HASH_B}\n`
  );

  assert.deepEqual(parseChecksumsFile(checksumPath), [
    {
      file: "WhyLowDPS.exe",
      hash: HASH_A,
    },
    {
      file: "WhyLowDPS.msi",
      hash: HASH_B,
    },
  ]);
});

test("parseChecksumsFile ignores empty and invalid lines", () => {
  const dir = makeTempDir();
  const checksumPath = path.join(dir, "checksums.txt");

  writeFile(
    checksumPath,
    "\n" +
    "not a checksum\n" +
    "short-hash  app.exe\n" +
    `${HASH_A}  valid.exe\n`
  );

  assert.deepEqual(parseChecksumsFile(checksumPath), [
    {
      file: "valid.exe",
      hash: HASH_A,
    },
  ]);
});

test("parseChecksumsFile preserves duplicate valid entries", () => {
  const dir = makeTempDir();
  const checksumPath = path.join(dir, "checksums.txt");

  writeFile(
    checksumPath,
    `${HASH_A}  app.exe\n` +
    `${HASH_B}  app.exe\n`
  );

  assert.deepEqual(parseChecksumsFile(checksumPath), [
    { file: "app.exe", hash: HASH_A },
    { file: "app.exe", hash: HASH_B },
  ]);
});

test("parseChecksumsFile throws when checksum file does not exist", () => {
  const dir = makeTempDir();
  const checksumPath = path.join(dir, "missing.txt");

  assert.throws(() => parseChecksumsFile(checksumPath), /ENOENT/);
});

test("buildReleaseNotes renders required sections", () => {
  const notes = buildReleaseNotes({
    version: "3.0.1",
    assetNames: ["WhyLowDPS_3.0.1_x64-setup.exe"],
    checksumEntries: [
      {
        file: "WhyLowDPS_3.0.1_x64-setup.exe",
        hash: HASH_B,
      },
    ],
  });

  assert.match(notes, /## Download/);
  assert.match(notes, /Recommended: WhyLowDPS_3.0.1_x64-setup\.exe/);
  assert.match(notes, /## Checksums/);
  assert.match(notes, /SHA256:/);
  assert.match(notes, /## Notes/);
  assert.match(notes, /Windows only/);
  assert.match(notes, /Unsigned build may show SmartScreen warning/);
  assert.match(notes, /Requires user-provided Battle\.net API credentials/);
});

test("buildReleaseNotes uses explicit recommended asset override", () => {
  const notes = buildReleaseNotes({
    version: "3.0.1",
    assetNames: ["WhyLowDPS_3.0.1_x64-setup.exe"],
    checksumEntries: [
      {
        file: "WhyLowDPS_3.0.1_x64-setup.exe",
        hash: HASH_A,
      },
    ],
    recommended: "manual-choice.zip",
  });

  assert.match(notes, /Recommended: manual-choice\.zip/);
});

test("buildReleaseNotes chooses recommended asset when override is empty", () => {
  const notes = buildReleaseNotes({
    version: "3.0.1",
    assetNames: [
      "archive.zip",
      "WhyLowDPS_3.0.1_x64-setup.exe",
    ],
    checksumEntries: [
      {
        file: "archive.zip",
        hash: HASH_A,
      },
    ],
    recommended: "",
  });

  assert.match(notes, /Recommended: WhyLowDPS_3.0.1_x64-setup\.exe/);
});

test("buildReleaseNotes filters falsy asset names before choosing recommended asset", () => {
  const notes = buildReleaseNotes({
    version: "3.0.1",
    assetNames: [
      "",
      null,
      undefined,
      "WhyLowDPS_3.0.1_x64-setup.exe",
    ],
    checksumEntries: [
      {
        file: "WhyLowDPS_3.0.1_x64-setup.exe",
        hash: HASH_A,
      },
    ],
  });

  assert.match(notes, /Recommended: WhyLowDPS_3.0.1_x64-setup\.exe/);
});

test("buildReleaseNotes sorts checksum lines by filename", () => {
  const notes = buildReleaseNotes({
    version: "3.0.1",
    assetNames: ["app.exe"],
    checksumEntries: [
      { file: "z.exe", hash: HASH_A },
      { file: "a.exe", hash: HASH_B },
      { file: "m.exe", hash: HASH_C },
    ],
  });

  const aIndex = notes.indexOf(`a.exe  ${HASH_B}`);
  const mIndex = notes.indexOf(`m.exe  ${HASH_C}`);
  const zIndex = notes.indexOf(`z.exe  ${HASH_A}`);

  assert.ok(aIndex > -1);
  assert.ok(mIndex > -1);
  assert.ok(zIndex > -1);
  assert.ok(aIndex < mIndex);
  assert.ok(mIndex < zIndex);
});

test("buildReleaseNotes supports empty checksum entries", () => {
  const notes = buildReleaseNotes({
    version: "3.0.1",
    assetNames: ["app.exe"],
    checksumEntries: [],
  });

  assert.match(notes, /SHA256:\n\n\n## Notes/);
});

test("buildReleaseNotes returns stable markdown structure", () => {
  const notes = buildReleaseNotes({
    version: "3.0.1",
    assetNames: ["app.exe"],
    checksumEntries: [{ file: "app.exe", hash: HASH_A }],
  });

  assert.equal(
    notes,
    [
      "## Download",
      "",
      "Recommended: app.exe",
      "",
      "## Checksums",
      "",
      "SHA256:",
      `app.exe  ${HASH_A}`,
      "",
      "## Notes",
      "",
      "- Windows only",
      "- Unsigned build may show SmartScreen warning",
      "- Requires user-provided Battle.net API credentials",
      "",
    ].join("\n")
  );
});

test("cli writes release notes successfully", () => {
  const dir = makeTempDir();
  const assetsFile = path.join(dir, "assets.txt");
  const checksumsFile = path.join(dir, "checksums.txt");
  const outputFile = path.join(dir, "release-notes.md");

  writeFile(
    assetsFile,
    "\nWhyLowDPS_3.0.1_x64-setup.exe\narchive.zip\n"
  );

  writeFile(
    checksumsFile,
    `${HASH_A}  WhyLowDPS_3.0.1_x64-setup.exe\n`
  );

  const result = spawnSync(
    process.execPath,
    [
      SCRIPT_PATH,
      "--version",
      "3.0.1",
      "--assets-file",
      assetsFile,
      "--checksums-file",
      checksumsFile,
      "--output",
      outputFile,
    ],
    {
      encoding: "utf8",
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(outputFile), true);

  const output = fs.readFileSync(outputFile, "utf8");

  assert.match(output, /Recommended: WhyLowDPS_3.0.1_x64-setup\.exe/);
  assert.match(output, new RegExp(`WhyLowDPS_3\\.0\\.1_x64-setup\\.exe  ${HASH_A}`));
});

test("cli supports explicit recommended asset", () => {
  const dir = makeTempDir();
  const assetsFile = path.join(dir, "assets.txt");
  const checksumsFile = path.join(dir, "checksums.txt");
  const outputFile = path.join(dir, "release-notes.md");

  writeFile(assetsFile, "app.exe\nmanual.zip\n");
  writeFile(checksumsFile, `${HASH_A}  app.exe\n`);

  const result = spawnSync(
    process.execPath,
    [
      SCRIPT_PATH,
      "--version",
      "3.0.1",
      "--assets-file",
      assetsFile,
      "--checksums-file",
      checksumsFile,
      "--output",
      outputFile,
      "--recommended",
      "manual.zip",
    ],
    {
      encoding: "utf8",
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    fs.readFileSync(outputFile, "utf8"),
    /Recommended: manual\.zip/
  );
});

test("cli exits with usage error when required args are missing", () => {
  const result = spawnSync(
    process.execPath,
    [SCRIPT_PATH],
    {
      encoding: "utf8",
    }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: node scripts\/release-notes\.js/);
});

test("cli fails when assets file is empty", () => {
  const dir = makeTempDir();
  const assetsFile = path.join(dir, "assets.txt");
  const checksumsFile = path.join(dir, "checksums.txt");
  const outputFile = path.join(dir, "release-notes.md");

  writeFile(assetsFile, "\n\n");
  writeFile(checksumsFile, `${HASH_A}  app.exe\n`);

  const result = spawnSync(
    process.execPath,
    [
      SCRIPT_PATH,
      "--version",
      "3.0.1",
      "--assets-file",
      assetsFile,
      "--checksums-file",
      checksumsFile,
      "--output",
      outputFile,
    ],
    {
      encoding: "utf8",
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No release assets found/);
});

test("cli fails when checksum file has no valid entries", () => {
  const dir = makeTempDir();
  const assetsFile = path.join(dir, "assets.txt");
  const checksumsFile = path.join(dir, "checksums.txt");
  const outputFile = path.join(dir, "release-notes.md");

  writeFile(assetsFile, "app.exe\n");
  writeFile(checksumsFile, "not valid\n");

  const result = spawnSync(
    process.execPath,
    [
      SCRIPT_PATH,
      "--version",
      "3.0.1",
      "--assets-file",
      assetsFile,
      "--checksums-file",
      checksumsFile,
      "--output",
      outputFile,
    ],
    {
      encoding: "utf8",
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No checksum entries found/);
});
