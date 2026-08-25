const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildGeneratedData, parseChangelogHistory } = require('../sync-changelog.js');

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
  assert.equal(releases[0].version, 'v4.1.0');
  assert.equal(releases[0].entries.length, 5);
  assert.ok(
    releases[0].entries.some(
      (entry) => entry.title === 'Keep readiness and runtime updates reliable'
    )
  );
});
