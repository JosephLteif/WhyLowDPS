const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const historyPath = path.join(repositoryRoot, 'docs', 'whats-new-history.md');
const changelogPath = path.join(repositoryRoot, 'CHANGELOG.md');

function normalizeVersion(value) {
  const version = String(value || '')
    .trim()
    .replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid release version: ${value}`);
  }
  return `v${version}`;
}

function normalizeDate(value) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid release date: ${value}`);
  }
  return date;
}

function getUnreleasedBody(markdown, headingPattern) {
  const match = markdown.match(headingPattern);
  if (!match) throw new Error('Changelog is missing an Unreleased section.');

  const body = match[1].replace(/^No unreleased changes yet\.\s*$/m, '').trim();
  if (!body || !/^###\s+/m.test(body)) {
    throw new Error('Unreleased changelog has no release notes to promote.');
  }

  return { match, body };
}

function updateReleaseIndex(markdown, version, date) {
  const tablePattern =
    /(^\| Version \| Tagged \| Version \| Tagged \|\n\| --- \| --- \| --- \| --- \|\n)([\s\S]*?)(?=\n\n|$(?![\s\S]))/m;
  const table = markdown.match(tablePattern);
  if (!table) return markdown;

  const entries = table[2]
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .flatMap((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim())
    )
    .reduce((pairs, cell, index, cells) => {
      if (index % 2 === 0 && cells[index + 1]) pairs.push([cell, cells[index + 1]]);
      return pairs;
    }, []);

  if (entries.some(([entryVersion]) => entryVersion === version)) return markdown;
  entries.unshift([version, date]);

  const rows = [];
  for (let index = 0; index < entries.length; index += 2) {
    const left = entries[index] || ['', ''];
    const right = entries[index + 1] || ['', ''];
    rows.push(`| ${left[0]} | ${left[1]} | ${right[0]} | ${right[1]} |`);
  }

  return markdown.replace(tablePattern, `${table[1]}${rows.join('\n')}`);
}

function promoteHistory(markdown, { version: rawVersion, date: rawDate, title } = {}) {
  const version = normalizeVersion(rawVersion);
  const date = normalizeDate(rawDate);
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
  const normalized = markdown.replace(/\r\n/g, '\n');
  const { match, body } = getUnreleasedBody(
    normalized,
    /^##\s+Unreleased[^\n]*\n([\s\S]*?)(?=^##\s+)/m
  );
  const releaseTitle = String(title || '').trim() || `Release notes for ${version}`;
  const replacement = [
    '## Unreleased',
    '',
    'No unreleased changes yet.',
    '',
    `## ${version} — ${date} — ${releaseTitle}`,
    '',
    body,
    '',
    '',
  ].join('\n');
  const promoted =
    normalized.slice(0, match.index) +
    replacement +
    normalized.slice(match.index + match[0].length);

  return updateReleaseIndex(promoted, version, date).replace(/\n/g, eol);
}

function promoteKeepAChangelog(markdown, { version: rawVersion, date: rawDate } = {}) {
  const version = normalizeVersion(rawVersion);
  const date = normalizeDate(rawDate);
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
  const normalized = markdown.replace(/\r\n/g, '\n');
  const { match, body } = getUnreleasedBody(
    normalized,
    /^##\s+\[Unreleased\]\n([\s\S]*?)(?=^##\s+\[v?\d+\.\d+\.\d+\])/m
  );
  const replacement = [
    '## [Unreleased]',
    '',
    'No unreleased changes yet.',
    '',
    `## [${version.slice(1)}] - ${date}`,
    '',
    body,
    '',
    '',
  ].join('\n');

  return (
    normalized.slice(0, match.index) +
    replacement +
    normalized.slice(match.index + match[0].length)
  ).replace(/\n/g, eol);
}

function promoteChangelog({
  version,
  date,
  title,
  historyFile = historyPath,
  changelogFile = changelogPath,
} = {}) {
  const options = { version, date, title };
  const history = fs.readFileSync(historyFile, 'utf8');
  const changelog = fs.readFileSync(changelogFile, 'utf8');
  const promotedHistory = promoteHistory(history, options);
  const promotedChangelog = promoteKeepAChangelog(changelog, options);
  fs.writeFileSync(historyFile, promotedHistory);
  fs.writeFileSync(changelogFile, promotedChangelog);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    args[argument.slice(2)] = argv[index + 1];
    index += 1;
  }
  return args;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    promoteChangelog({ version: args.version, date: args.date, title: args.title });
    console.log(`Promoted Unreleased changelog to ${normalizeVersion(args.version)}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

module.exports = {
  normalizeVersion,
  promoteChangelog,
  promoteHistory,
  promoteKeepAChangelog,
};
