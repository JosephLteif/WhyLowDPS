const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const WORKFLOW_PATH = path.join(
  ROOT,
  ".github",
  "workflows",
  "dependabot-auto-merge.yml",
);

function readWorkflow() {
  return fs.readFileSync(WORKFLOW_PATH, "utf8");
}

test("Dependabot auto-merge does not depend on a hard-coded reviewer", () => {
  const workflow = readWorkflow();

  assert.match(workflow, /contents:\s+write/);
  assert.match(workflow, /pull-requests:\s+write/);
  assert.doesNotMatch(workflow, /gh pr edit .*--add-reviewer/);
  assert.doesNotMatch(workflow, /gh pr review .*--approve/);
});

test("Dependabot auto-merge enables squash auto-merge after metadata checks", () => {
  const workflow = readWorkflow();
  const metadataStep = workflow.indexOf("dependabot/fetch-metadata@v2");
  const mergeCommand = workflow.indexOf('gh pr merge "$PR_URL" --auto --squash');

  assert.notEqual(metadataStep, -1);
  assert.notEqual(mergeCommand, -1);
  assert.ok(metadataStep < mergeCommand);
  assert.match(workflow, /version-update:semver-patch/);
  assert.match(workflow, /version-update:semver-minor/);
});
