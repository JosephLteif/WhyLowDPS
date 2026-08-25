const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const historyPath = path.join(repositoryRoot, 'docs', 'whats-new-history.md');
const generatedPath = path.join(
  repositoryRoot,
  'frontend',
  'src',
  'app',
  'lib',
  'changelog.generated.json'
);

const categoryByHeading = new Map([
  ['New features', 'feature'],
  ['Improvements', 'improvement'],
  ['Bug fixes', 'fix'],
  ['Documentation', 'documentation'],
]);

function parseChangelogHistory(markdown) {
  const releases = [];
  let release = null;
  let category = null;
  let entry = null;

  const finishEntry = () => {
    if (!entry) return;

    const summary = entry.summary.join(' ').trim();
    if (!summary) {
      throw new Error(`Changelog entry "${entry.title}" is missing a summary.`);
    }

    release.entries.push({
      category: entry.category,
      title: entry.title,
      summary,
      ...(entry.items.length > 0 ? { items: entry.items } : {}),
    });
    entry = null;
  };

  for (const rawLine of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim();
    const releaseHeading = line.match(
      /^##\s+(v\d+\.\d+\.\d+)\s+—\s+(\d{4}-\d{2}-\d{2})(?:\s+—\s+(.+))?$/
    );

    if (releaseHeading) {
      finishEntry();
      release = {
        version: releaseHeading[1],
        date: releaseHeading[2],
        title: releaseHeading[3]?.trim() || `Release notes for ${releaseHeading[1]}`,
        entries: [],
      };
      releases.push(release);
      category = null;
      continue;
    }

    if (/^##\s+Release index$/.test(line)) {
      finishEntry();
      release = null;
      category = null;
      continue;
    }

    if (!release || line === '') continue;

    const categoryHeading = line.match(/^###\s+(.+)$/);
    if (categoryHeading) {
      finishEntry();
      category = categoryByHeading.get(categoryHeading[1]);
      if (!category) {
        throw new Error(`Unsupported changelog category: ${categoryHeading[1]}`);
      }
      continue;
    }

    const entryHeading = line.match(/^####\s+(.+)$/);
    if (entryHeading) {
      finishEntry();
      if (!category) {
        throw new Error(`Changelog entry "${entryHeading[1]}" is missing a category.`);
      }
      entry = { category, title: entryHeading[1], summary: [], items: [] };
      continue;
    }

    const listItem = line.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      if (!entry) {
        throw new Error(`Changelog list item is not attached to an entry: ${line}`);
      }
      entry.items.push(listItem[1].trim());
      continue;
    }

    if (!entry) {
      throw new Error(`Unexpected changelog content: ${line}`);
    }
    entry.summary.push(line);
  }

  finishEntry();
  if (releases.length === 0) throw new Error('No versioned changelog releases found.');

  for (const parsedRelease of releases) {
    if (parsedRelease.entries.length === 0) {
      throw new Error(`${parsedRelease.version} has no changelog entries.`);
    }
  }

  return releases;
}

function buildGeneratedData(releases) {
  const latestContentHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(releases[0]))
    .digest('hex')
    .slice(0, 12);
  const revision = `${releases[0].version}-${latestContentHash}`;

  return `${JSON.stringify({ contentRevision: revision, releases }, null, 2)}\n`;
}

function syncChangelog({ check = false } = {}) {
  const releases = parseChangelogHistory(fs.readFileSync(historyPath, 'utf8'));
  const generated = buildGeneratedData(releases);
  const current = fs.existsSync(generatedPath) ? fs.readFileSync(generatedPath, 'utf8') : '';

  if (current !== generated) {
    if (check) {
      throw new Error(
        `Generated changelog is out of date. Run "npm run sync:changelog" and commit ${path.relative(
          repositoryRoot,
          generatedPath
        )}.`
      );
    }
    fs.writeFileSync(generatedPath, generated);
  }

  return { releases, changed: current !== generated };
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  try {
    const result = syncChangelog({ check });
    console.log(
      `${check ? 'Checked' : result.changed ? 'Generated' : 'Already current'} changelog data for ${
        result.releases[0].version
      }.`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

module.exports = { buildGeneratedData, parseChangelogHistory, syncChangelog };
