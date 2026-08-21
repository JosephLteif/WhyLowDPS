const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");

function readRepositoryFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("production Compose uses a conventional fixed latest image", () => {
  const compose = readRepositoryFile("compose.yaml");

  assert.match(compose, /image:\s+ghcr\.io\/josephlteif\/whylowdps:latest/);
  assert.doesNotMatch(compose, /WHYLOWDPS_(?:IMAGE|VERSION)/);
});

test("Docker environment example does not select the image tag", () => {
  const environment = readRepositoryFile(".env.docker.example");

  assert.doesNotMatch(environment, /^WHYLOWDPS_VERSION=/m);
  assert.match(environment, /^WHYLOWDPS_HOST_IP=/m);
});

test("release workflow publishes latest and versioned tags and records rollback references", () => {
  const workflow = readRepositoryFile(".github/workflows/release.yml");

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
});
