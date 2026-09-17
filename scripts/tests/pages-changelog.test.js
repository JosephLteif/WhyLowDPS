const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildChangelogPage } = require('../build-pages-changelog.js');

const historyPath = path.resolve(__dirname, '../../docs/whats-new-history.md');

test('buildChangelogPage renders the public release archive', () => {
  const page = buildChangelogPage(fs.readFileSync(historyPath, 'utf8'));

  assert.match(page, /<title>What&#39;s New \| WhyLowDPS<\/title>/);
  assert.match(page, /data-release-version="v4\.1\.0"/);
  assert.match(page, /data-release-version="v4\.0\.0"/);
  assert.match(page, /Make System Health an optional dashboard widget/);
  assert.match(page, /data-release-version="v3\.8\.0"/);
  assert.match(
    page,
    /https:\/\/github\.com\/JosephLteif\/simcraft\/releases\/tag\/v3\.8\.0/
  );
  assert.match(
    page,
    /https:\/\/github\.com\/JosephLteif\/simcraft\/releases\/tag\/v4\.1\.0/
  );
  assert.match(page, /<select id="release-version"/);
  assert.match(page, /<option value="v6\.0\.1">v6\.0\.1<\/option>/);
  assert.match(page, /history\.replaceState/);
  assert.doesNotMatch(page, /\bUnreleased\b/);
  assert.doesNotMatch(page, /promote-dev|republish|update `master`/);
  assert.doesNotMatch(page, /Keep stable release notes synchronized/);
  assert.doesNotMatch(page, /Rework the release pipeline/);
  assert.doesNotMatch(page, /source-mode|dev:desktop|Desktop development now synchronizes/);
  assert.doesNotMatch(page, /docs\/whats-new-history\.md/);
});

test('buildChangelogPage removes internal workflow wording from release entries', () => {
  const page = buildChangelogPage(`
## v1.0.0 — 2026-01-01 — Release notes for v1.0.0

### Improvements

#### User-visible improvement

The release is easier to use.

#### Internal release workflow

Keep unreleased notes separate before promote-dev; republish only rebuilds an existing tag.
`);

  assert.match(page, /The release is easier to use/);
  assert.doesNotMatch(page, /unreleased|promote-dev|republish/i);
});
