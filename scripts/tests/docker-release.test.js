const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function readRepositoryFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('production Compose uses a conventional fixed latest image', () => {
  const compose = readRepositoryFile('compose.yaml');

  assert.match(compose, /image:\s+ghcr\.io\/josephlteif\/whylowdps:latest/);
  assert.doesNotMatch(compose, /WHYLOWDPS_(?:IMAGE|VERSION)/);
});

test('Docker environment example does not select the image tag', () => {
  const environment = readRepositoryFile('.env.docker.example');

  assert.doesNotMatch(environment, /^WHYLOWDPS_VERSION=/m);
  assert.match(environment, /^WHYLOWDPS_HOST_IP=/m);
});

test('Docker frontend build includes changelog synchronization inputs', () => {
  const dockerfile = readRepositoryFile('Dockerfile');

  assert.match(dockerfile, /COPY docs\/whats-new-history\.md \.\/docs\/whats-new-history\.md/);
  assert.match(dockerfile, /COPY scripts\/sync-changelog\.js \.\/scripts\/sync-changelog\.js/);
});

test('release workflow publishes latest and versioned tags and records rollback references', () => {
  const workflow = readRepositoryFile('.github/workflows/release.yml');

  assert.match(workflow, /type=semver,pattern=\{\{version\}\}/);
  assert.match(workflow, /type=semver,pattern=\{\{major\}\}\.\{\{minor\}\}/);
  assert.match(workflow, /type=raw,value=latest/);
  assert.doesNotMatch(workflow, /type=raw,value=stable/);
  assert.match(workflow, /WHYLOWDPS_VERSION=\$\{\{ steps\.meta\.outputs\.version \}\}/);
  assert.match(workflow, /cp \.env\.docker\.example "\$\{BUNDLE_DIR\}\/\.env\.docker\.example"/);
  assert.doesNotMatch(workflow, /sed .*WHYLOWDPS_VERSION/);
  assert.match(workflow, /whylowdps:latest.*docker-image\.txt/);
  assert.match(workflow, /whylowdps:%s.*docker-image\.txt/);
  assert.match(workflow, /whylowdps@%s.*docker-image\.txt/);
  assert.match(
    workflow,
    /name: Promote Unreleased changelog[\s\S]*node scripts\/promote-changelog\.js[\s\S]*npm run sync:changelog/
  );
  assert.match(
    workflow,
    /git add[\s\S]*CHANGELOG\.md docs\/whats-new-history\.md frontend\/src\/app\/lib\/changelog\.generated\.json/
  );
  assert.match(workflow, /finalize-release:[\s\S]*if:[\s\S]*always\(\) &&/);
});

test('release workflow exposes a moving developer channel', () => {
  const workflow = readRepositoryFile('.github/workflows/release.yml');

  assert.match(workflow, /release_channel:[\s\S]*?- stable[\s\S]*?- dev/);
  assert.match(workflow, /dev_source_ref:[\s\S]*default: dev/);
  assert.match(
    workflow,
    /prepare-dev:[\s\S]*git tag --force dev[\s\S]*git push origin refs\/tags\/dev --force/
  );
  assert.match(workflow, /releases\/download\/dev\/latest\.json/);
  assert.match(workflow, /releaseDraft: "\$\{\{ env\.RELEASE_CHANNEL != 'dev' \}\}"/);
  assert.match(workflow, /prerelease: "\$\{\{ env\.RELEASE_CHANNEL == 'dev' \}\}"/);
  assert.match(workflow, /finalize-dev:[\s\S]*latest\.json/);
});

test('release workflow can republish an existing version without bumping it', () => {
  const workflow = readRepositoryFile('.github/workflows/release.yml');

  assert.match(workflow, /release_mode:[\s\S]*?- republish/);
  assert.match(workflow, /existing_version:[\s\S]*?type: string/);
  assert.match(workflow, /inputs\.release_mode == 'bump'/);
  assert.match(workflow, /inputs\.release_mode == 'republish'/);
  assert.match(workflow, /git ls-remote --exit-code origin "refs\/tags\/v\$\{EXISTING_VERSION\}"/);
  assert.match(
    workflow,
    /ref: \$\{\{ github\.event_name == 'workflow_dispatch'[\s\S]*format\('v\{0\}', inputs\.existing_version\)/
  );
  assert.match(
    workflow,
    /name: Ensure container resource paths exist[\s\S]*mkdir -p backend\/resources\/data/
  );
  assert.match(workflow, /RELEASE_TAG#v/);
});

test('manual version bumps publish in the same workflow run', () => {
  const workflow = readRepositoryFile('.github/workflows/release.yml');

  assert.match(workflow, /token: \$\{\{ secrets\.RELEASE_TOKEN \}\}/);
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /git push origin master[\s\S]*http\.extraheader=AUTHORIZATION: basic/);
  assert.doesNotMatch(workflow, /git push origin "v\$\{\{ steps\.bump\.outputs\.new_version \}\}"/);
  assert.match(
    workflow,
    /outputs:[\s\S]*release_tag: \$\{\{ steps\.release\.outputs\.release_tag \}\}/
  );
  assert.match(workflow, /needs: \[bump-version-stable, prepare-dev, validate_republish\]/);
  assert.match(
    workflow,
    /github\.event_name == 'workflow_dispatch' && inputs\.release_channel == 'stable' && inputs\.release_mode == 'bump' && needs\.bump-version-stable\.result == 'success'/
  );
});
