const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildGeneratedData, parseChangelogHistory } = require('../sync-changelog.js');
const { promoteHistory, promoteKeepAChangelog } = require('../promote-changelog.js');

const repositoryRoot = path.resolve(__dirname, '../..');
const historyPath = path.join(repositoryRoot, 'docs', 'whats-new-history.md');
const generatedPath = path.join(
  repositoryRoot,
  'frontend',
  'src',
  'app',
  'lib',
  'changelog.generated.json'
);

test('generated app changelog data matches the public history source', () => {
  const releases = parseChangelogHistory(fs.readFileSync(historyPath, 'utf8'));
  const generated = fs.readFileSync(generatedPath, 'utf8');

  assert.equal(generated, buildGeneratedData(releases));
  assert.ok(releases.length > 0);
  assert.ok(releases[0].entries.length > 0);
  assert.ok(
    releases.every(
      (release) =>
        /^Unreleased$|^v\d+\.\d+\.\d+$/.test(release.version) && release.entries.length > 0
    )
  );
});

test('empty Unreleased sections are omitted from generated app data', () => {
  const releases = parseChangelogHistory(`
## Unreleased

No unreleased changes yet.

## v1.0.0 — 2026-01-01

### Bug fixes

#### A fix

The fix is included.
`);

  assert.deepEqual(
    releases.map((release) => release.version),
    ['v1.0.0']
  );
});

test('promotes Unreleased notes into the selected stable version', () => {
  const history = `# What's New History

## Unreleased

### Bug fixes

#### A fix

The fix is included.

## v4.1.0 — 2026-08-24

### Improvements

#### Existing work

The existing work remains.

## Release index

| Version | Tagged | Version | Tagged |
| --- | --- | --- | --- |
| v4.1.0 | 2026-08-24 | v4.0.0 | 2026-08-21 |
| v3.9.0 | 2026-08-18 | v3.8.0 | 2026-08-16 |
`;
  const changelog = `# Changelog

## [Unreleased]

### Fixed

- The fix is included.

## [4.1.0] - 2026-08-24

### Changed

- Existing work remains.
`;

  const promotedHistory = promoteHistory(history, { version: '4.2.0', date: '2026-08-25' });
  const promotedChangelog = promoteKeepAChangelog(changelog, {
    version: '4.2.0',
    date: '2026-08-25',
  });

  assert.match(promotedHistory, /## Unreleased\n\nNo unreleased changes yet\./);
  assert.match(promotedHistory, /## v4\.2\.0 — 2026-08-25 — Release notes for v4\.2\.0/);
  assert.match(promotedHistory, /\| v4\.2\.0 \| 2026-08-25 \|/);
  assert.match(promotedHistory, /\| v3\.9\.0 \| 2026-08-18 \|/);
  assert.match(promotedHistory, /\| v3\.8\.0 \| 2026-08-16 \|/);
  assert.match(promotedChangelog, /## \[Unreleased\]\n\nNo unreleased changes yet\./);
  assert.match(promotedChangelog, /## \[4\.2\.0\] - 2026-08-25/);
  assert.match(promotedChangelog, /The fix is included\./);
});
