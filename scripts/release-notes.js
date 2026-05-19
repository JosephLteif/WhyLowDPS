const fs = require("fs");
const path = require("path");

function chooseRecommendedAsset(version, assetNames) {
  const normalized = Array.isArray(assetNames) ? assetNames.filter(Boolean) : [];
  const preferred = `WhyLowDPS_${version}_x64-setup.exe`;
  if (normalized.includes(preferred)) return preferred;

  const setup = [...normalized].sort().find((name) => name.endsWith("setup.exe"));
  if (setup) return setup;

  const exe = [...normalized].sort().find((name) => name.endsWith(".exe"));
  if (exe) return exe;

  return [...normalized].sort()[0] || "";
}

function parseChecksumsFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const entries = [];
  for (const line of lines) {
    const twoSpace = line.indexOf("  ");
    if (twoSpace > 0) {
      const left = line.slice(0, twoSpace).trim();
      const right = line.slice(twoSpace + 2).trim();
      if (/^[a-f0-9]{64}$/i.test(left) && right) {
        entries.push({ file: path.basename(right), hash: left.toLowerCase() });
        continue;
      }
      if (/^[a-f0-9]{64}$/i.test(right) && left) {
        entries.push({ file: path.basename(left), hash: right.toLowerCase() });
        continue;
      }
    }

    const parts = line.split(/\s+/);
    if (parts.length >= 2) {
      const first = parts[0];
      const last = parts[parts.length - 1];
      if (/^[a-f0-9]{64}$/i.test(first)) {
        entries.push({ file: path.basename(last), hash: first.toLowerCase() });
      } else if (/^[a-f0-9]{64}$/i.test(last)) {
        entries.push({ file: path.basename(first), hash: last.toLowerCase() });
      }
    }
  }
  return entries;
}

function buildReleaseNotes({ version, assetNames, checksumEntries, recommended }) {
  const assets = Array.isArray(assetNames) ? assetNames.filter(Boolean) : [];
  const picked = recommended || chooseRecommendedAsset(version, assets);
  const orderedChecksums = [...checksumEntries].sort((a, b) => a.file.localeCompare(b.file));
  const checksumLines = orderedChecksums.map((entry) => `${entry.file}  ${entry.hash}`).join("\n");

  return [
    "## Download",
    "",
    `Recommended: ${picked}`,
    "",
    "## Checksums",
    "",
    "SHA256:",
    checksumLines,
    "",
    "## Notes",
    "",
    "- Windows only",
    "- Unsigned build may show SmartScreen warning",
    "- Requires user-provided Battle.net API credentials",
    "",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function cli() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.version || !args["assets-file"] || !args["checksums-file"] || !args.output) {
    console.error(
      "Usage: node scripts/release-notes.js --version <version> --assets-file <path> --checksums-file <path> --output <path>"
    );
    process.exit(1);
  }

  const assetNames = fs
    .readFileSync(args["assets-file"], "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const checksumEntries = parseChecksumsFile(args["checksums-file"]);
  if (assetNames.length === 0) {
    throw new Error("No release assets found.");
  }
  if (checksumEntries.length === 0) {
    throw new Error("No checksum entries found.");
  }

  const notes = buildReleaseNotes({
    version: args.version,
    assetNames,
    checksumEntries,
    recommended: args.recommended || "",
  });

  fs.writeFileSync(args.output, notes);
}

if (require.main === module) {
  cli();
}

module.exports = {
  buildReleaseNotes,
  chooseRecommendedAsset,
  parseChecksumsFile,
};
