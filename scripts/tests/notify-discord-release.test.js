const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPayload,
  getChannelConfig,
  normalizeChannel,
  selectWebhookUrl,
} = require("../notify-discord-release.js");

test("normalizeChannel trims and lowercases input", () => {
  assert.equal(normalizeChannel(" Weekly "), "weekly");
  assert.equal(normalizeChannel(""), "");
  assert.equal(normalizeChannel(undefined), "");
});

test("getChannelConfig returns expected values for all channels", () => {
  assert.deepEqual(getChannelConfig("nightly"), {
    channel: "nightly",
    titlePrefix: "Nightly Release",
    color: 3447003,
  });
  assert.deepEqual(getChannelConfig("weekly"), {
    channel: "weekly",
    titlePrefix: "Weekly Release",
    color: 15844367,
  });
  assert.deepEqual(getChannelConfig("stable"), {
    channel: "stable",
    titlePrefix: "Stable Release",
    color: 3066993,
  });
});

test("getChannelConfig rejects unsupported channel", () => {
  assert.throws(() => getChannelConfig("canary"), /Unsupported channel/);
});

test("selectWebhookUrl chooses correct webhook by normalized channel", () => {
  const webhooks = {
    nightly: "https://discord.example/nightly",
    weekly: "https://discord.example/weekly",
    stable: "https://discord.example/stable",
  };
  assert.equal(selectWebhookUrl(" Nightly ", webhooks), webhooks.nightly);
  assert.equal(selectWebhookUrl("weekly", webhooks), webhooks.weekly);
  assert.equal(selectWebhookUrl("stable", webhooks), webhooks.stable);
});

test("selectWebhookUrl rejects missing webhook for selected channel", () => {
  assert.throws(
    () => selectWebhookUrl("nightly", { nightly: "", weekly: "x", stable: "y" }),
    /Missing Discord webhook URL for channel: nightly/
  );
});

test("buildPayload formats embed correctly", () => {
  const payload = buildPayload({
    channel: "weekly",
    tag: "v3.1.5-weekly.202621",
    releaseUrl: "https://github.com/org/repo/releases/tag/v3.1.5-weekly.202621",
  });

  assert.equal(payload.content, "");
  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].title, "Weekly Release: v3.1.5-weekly.202621");
  assert.equal(payload.embeds[0].description, "A new **weekly** build is available.");
  assert.equal(payload.embeds[0].color, 15844367);
  assert.deepEqual(payload.embeds[0].fields[0], {
    name: "Version",
    value: "`3.1.5-weekly.202621`",
    inline: true,
  });
  assert.deepEqual(payload.embeds[0].fields[1], {
    name: "Channel",
    value: "`weekly`",
    inline: true,
  });
  assert.deepEqual(payload.embeds[0].fields[2], {
    name: "Downloads",
    value: "[Open GitHub Release](https://github.com/org/repo/releases/tag/v3.1.5-weekly.202621)",
    inline: false,
  });
});
