const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildChangelogPage } = require('../build-pages-changelog.js');

const historyPath = path.resolve(__dirname, '../../docs/whats-new-history.md');

test('buildChangelogPage renders the public release archive', () => {
  const page = buildChangelogPage(fs.readFileSync(historyPath, 'utf8'));

  assert.match(page, /<title>What&#39;s New History \| WhyLowDPS<\/title>/);
  assert.match(page, /v4\.1\.0 — 2026-08-24/);
  assert.match(page, /v4\.0\.0 — 2026-08-21/);
  assert.match(page, /Make System Health an optional dashboard widget/);
  assert.match(page, /v3\.8\.0 — 2026-08-16/);
  assert.match(
    page,
    /https:\/\/github\.com\/JosephLteif\/simcraft\/releases\/tag\/v3\.8\.0/
  );
  assert.match(
    page,
    /https:\/\/github\.com\/JosephLteif\/simcraft\/releases\/tag\/v4\.1\.0/
  );
  assert.match(page, /class="history-table-wrap"/);
});
