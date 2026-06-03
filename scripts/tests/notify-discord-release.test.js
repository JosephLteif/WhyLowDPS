const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {
  buildPayload,
  getChannelConfig,
  normalizeChannel,
  selectWebhookUrl,
  postJson,
  main,
} = require("../notify-discord-release.js");

function mockHttpsRequest(handler) {
  const https = require("node:https");
  const original = https.request;

  https.request = handler;

  return () => {
    https.request = original;
  };
}

function makeResponse(statusCode, body = "") {
  const response = new EventEmitter();
  response.statusCode = statusCode;

  process.nextTick(() => {
    if (body) response.emit("data", Buffer.from(body));
    response.emit("end");
  });

  return response;
}

function makeRequest() {
  const request = new EventEmitter();
  request.write = (body) => {
    request.body = body;
  };
  request.end = () => {};
  return request;
}

test("normalizeChannel trims and lowercases input", () => {
  assert.equal(normalizeChannel(" Weekly "), "weekly");
  assert.equal(normalizeChannel("NIGHTLY"), "nightly");
  assert.equal(normalizeChannel(" Stable "), "stable");
  assert.equal(normalizeChannel(""), "");
  assert.equal(normalizeChannel(undefined), "");
  assert.equal(normalizeChannel(null), "");
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

test("getChannelConfig accepts mixed-case and padded channel names", () => {
  assert.equal(getChannelConfig(" NIGHTLY ").channel, "nightly");
  assert.equal(getChannelConfig("WeEkLy").channel, "weekly");
  assert.equal(getChannelConfig(" STABLE ").channel, "stable");
});

test("getChannelConfig rejects unsupported channel", () => {
  assert.throws(() => getChannelConfig("canary"), /Unsupported channel/);
  assert.throws(() => getChannelConfig(""), /Unsupported channel/);
  assert.throws(() => getChannelConfig(undefined), /Unsupported channel/);
});

test("selectWebhookUrl chooses correct webhook by normalized channel", () => {
  const webhooks = {
    nightly: "https://discord.example/nightly",
    weekly: "https://discord.example/weekly",
    stable: "https://discord.example/stable",
  };

  assert.equal(selectWebhookUrl(" Nightly ", webhooks), webhooks.nightly);
  assert.equal(selectWebhookUrl("weekly", webhooks), webhooks.weekly);
  assert.equal(selectWebhookUrl("STABLE", webhooks), webhooks.stable);
});

test("selectWebhookUrl rejects missing webhook for selected channel", () => {
  assert.throws(
    () => selectWebhookUrl("nightly", { nightly: "", weekly: "x", stable: "y" }),
    /Missing Discord webhook URL for channel: nightly/
  );

  assert.throws(
    () => selectWebhookUrl("weekly", { nightly: "x", weekly: "", stable: "y" }),
    /Missing Discord webhook URL for channel: weekly/
  );

  assert.throws(
    () => selectWebhookUrl("stable", { nightly: "x", weekly: "y", stable: "" }),
    /Missing Discord webhook URL for channel: stable/
  );
});

test("selectWebhookUrl rejects when webhooks object is missing", () => {
  assert.throws(
    () => selectWebhookUrl("stable"),
    /Missing Discord webhook URL for channel: stable/
  );
});

test("buildPayload formats weekly embed correctly", () => {
  const payload = buildPayload({
    channel: "weekly",
    tag: "v3.1.5-weekly.202621",
    releaseUrl: "https://github.com/org/repo/releases/tag/v3.1.5-weekly.202621",
  });

  assert.equal(payload.content, "");
  assert.equal(payload.embeds.length, 1);

  const embed = payload.embeds[0];

  assert.equal(embed.title, "Weekly Release: v3.1.5-weekly.202621");
  assert.equal(embed.description, "A new **weekly** build is available.");
  assert.equal(embed.color, 15844367);

  assert.deepEqual(embed.fields[0], {
    name: "Version",
    value: "`3.1.5-weekly.202621`",
    inline: true,
  });

  assert.deepEqual(embed.fields[1], {
    name: "Channel",
    value: "`weekly`",
    inline: true,
  });

  assert.deepEqual(embed.fields[2], {
    name: "Downloads",
    value:
      "[Open GitHub Release](https://github.com/org/repo/releases/tag/v3.1.5-weekly.202621)",
    inline: false,
  });
});

test("buildPayload strips leading v from version field but keeps title normalized", () => {
  const payload = buildPayload({
    channel: "stable",
    tag: "v1.2.3",
    releaseUrl: "https://example.com/release",
  });

  assert.equal(payload.embeds[0].title, "Stable Release: v1.2.3");
  assert.equal(payload.embeds[0].fields[0].value, "`1.2.3`");
});

test("buildPayload adds v to title when tag has no leading v", () => {
  const payload = buildPayload({
    channel: "stable",
    tag: "1.2.3",
    releaseUrl: "https://example.com/release",
  });

  assert.equal(payload.embeds[0].title, "Stable Release: v1.2.3");
  assert.equal(payload.embeds[0].fields[0].value, "`1.2.3`");
});

test("buildPayload uses channel-specific colors and descriptions", () => {
  const nightly = buildPayload({
    channel: "nightly",
    tag: "v1.0.0",
    releaseUrl: "https://example.com",
  });

  const weekly = buildPayload({
    channel: "weekly",
    tag: "v1.0.0",
    releaseUrl: "https://example.com",
  });

  const stable = buildPayload({
    channel: "stable",
    tag: "v1.0.0",
    releaseUrl: "https://example.com",
  });

  assert.equal(nightly.embeds[0].color, 3447003);
  assert.equal(weekly.embeds[0].color, 15844367);
  assert.equal(stable.embeds[0].color, 3066993);

  assert.equal(nightly.embeds[0].description, "A new **nightly** build is available.");
  assert.equal(weekly.embeds[0].description, "A new **weekly** build is available.");
  assert.equal(stable.embeds[0].description, "A new **stable** build is available.");
});

test("postJson resolves on 2xx response", async () => {
  let capturedUrl;
  let capturedOptions;
  let capturedBody;

  const restore = mockHttpsRequest((url, options, callback) => {
    capturedUrl = url;
    capturedOptions = options;

    const request = makeRequest();
    request.write = (body) => {
      capturedBody = body;
    };

    callback(makeResponse(204));
    return request;
  });

  try {
    await postJson("https://discord.example/webhook", { hello: "world" });

    assert.equal(capturedUrl, "https://discord.example/webhook");
    assert.equal(capturedOptions.method, "POST");
    assert.equal(capturedOptions.headers["content-type"], "application/json");
    assert.equal(capturedOptions.headers["content-length"], Buffer.byteLength(capturedBody));
    assert.deepEqual(JSON.parse(capturedBody), { hello: "world" });
  } finally {
    restore();
  }
});

test("postJson rejects on non-2xx response and includes response body", async () => {
  const restore = mockHttpsRequest((url, options, callback) => {
    const request = makeRequest();
    callback(makeResponse(500, "discord exploded"));
    return request;
  });

  try {
    await assert.rejects(
      () => postJson("https://discord.example/webhook", { hello: "world" }),
      /Discord webhook request failed \(500\): discord exploded/
    );
  } finally {
    restore();
  }
});

test("postJson rejects on unknown status code", async () => {
  const restore = mockHttpsRequest((url, options, callback) => {
    const request = makeRequest();
    callback(makeResponse(undefined, "no status"));
    return request;
  });

  try {
    await assert.rejects(
      () => postJson("https://discord.example/webhook", { hello: "world" }),
      /Discord webhook request failed \(unknown\): no status/
    );
  } finally {
    restore();
  }
});

test("postJson rejects on request error", async () => {
  const restore = mockHttpsRequest(() => {
    const request = makeRequest();

    process.nextTick(() => {
      request.emit("error", new Error("network down"));
    });

    return request;
  });

  try {
    await assert.rejects(
      () => postJson("https://discord.example/webhook", { hello: "world" }),
      /network down/
    );
  } finally {
    restore();
  }
});

test("main rejects when TAG is missing", async () => {
  const oldEnv = process.env;

  process.env = {
    ...oldEnv,
    CHANNEL: "stable",
    TAG: "",
    RELEASE_URL: "https://github.com/org/repo/releases/tag/v1.0.0",
    STABLE_WEBHOOK: "https://discord.example/stable",
  };

  try {
    await assert.rejects(() => main(), /Missing TAG environment variable/);
  } finally {
    process.env = oldEnv;
  }
});

test("main rejects when RELEASE_URL is missing", async () => {
  const oldEnv = process.env;

  process.env = {
    ...oldEnv,
    CHANNEL: "stable",
    TAG: "v1.0.0",
    RELEASE_URL: "",
    STABLE_WEBHOOK: "https://discord.example/stable",
  };

  try {
    await assert.rejects(() => main(), /Missing RELEASE_URL environment variable/);
  } finally {
    process.env = oldEnv;
  }
});

test("main rejects when selected webhook is missing", async () => {
  const oldEnv = process.env;

  process.env = {
    ...oldEnv,
    CHANNEL: "stable",
    TAG: "v1.0.0",
    RELEASE_URL: "https://github.com/org/repo/releases/tag/v1.0.0",
    NIGHTLY_WEBHOOK: "https://discord.example/nightly",
    WEEKLY_WEBHOOK: "https://discord.example/weekly",
    STABLE_WEBHOOK: "",
  };

  try {
    await assert.rejects(
      () => main(),
      /Missing Discord webhook URL for channel: stable/
    );
  } finally {
    process.env = oldEnv;
  }
});

test("main posts stable release payload to selected webhook", async () => {
  const oldEnv = process.env;
  let capturedUrl;
  let capturedPayload;

  const restore = mockHttpsRequest((url, options, callback) => {
    capturedUrl = url;

    const request = makeRequest();
    request.write = (body) => {
      capturedPayload = JSON.parse(body);
    };

    callback(makeResponse(204));
    return request;
  });

  process.env = {
    ...oldEnv,
    CHANNEL: "stable",
    TAG: "v1.2.3",
    RELEASE_URL: "https://github.com/org/repo/releases/tag/v1.2.3",
    NIGHTLY_WEBHOOK: "https://discord.example/nightly",
    WEEKLY_WEBHOOK: "https://discord.example/weekly",
    STABLE_WEBHOOK: "https://discord.example/stable",
  };

  try {
    await main();

    assert.equal(capturedUrl, "https://discord.example/stable");
    assert.equal(capturedPayload.embeds[0].title, "Stable Release: v1.2.3");
    assert.equal(capturedPayload.embeds[0].description, "A new **stable** build is available.");
  } finally {
    process.env = oldEnv;
    restore();
  }
});

test("main posts nightly release payload to selected webhook", async () => {
  const oldEnv = process.env;
  let capturedUrl;
  let capturedPayload;

  const restore = mockHttpsRequest((url, options, callback) => {
    capturedUrl = url;

    const request = makeRequest();
    request.write = (body) => {
      capturedPayload = JSON.parse(body);
    };

    callback(makeResponse(204));
    return request;
  });

  process.env = {
    ...oldEnv,
    CHANNEL: "nightly",
    TAG: "v1.2.3-nightly.20260605",
    RELEASE_URL: "https://github.com/org/repo/releases/tag/v1.2.3-nightly.20260605",
    NIGHTLY_WEBHOOK: "https://discord.example/nightly",
    WEEKLY_WEBHOOK: "https://discord.example/weekly",
    STABLE_WEBHOOK: "https://discord.example/stable",
  };

  try {
    await main();

    assert.equal(capturedUrl, "https://discord.example/nightly");
    assert.equal(capturedPayload.embeds[0].title, "Nightly Release: v1.2.3-nightly.20260605");
    assert.equal(capturedPayload.embeds[0].description, "A new **nightly** build is available.");
  } finally {
    process.env = oldEnv;
    restore();
  }
});

test("CLI wrapper logs error and exits with code 1 when main fails", async () => {
  const scriptPath = path.resolve(__dirname, "../notify-discord-release.js");
  const source = fs.readFileSync(scriptPath, "utf8");

  const errors = [];
  let exitCode;

  const module = { exports: {} };

  const fakeRequire = (name) => {
    if (name === "node:https") {
      return {
        request() {
          throw new Error("https should not be called");
        },
      };
    }
    return require(name);
  };

  fakeRequire.main = module;

  const sandbox = {
    require: fakeRequire,
    module,
    exports: module.exports,
    __dirname: path.dirname(scriptPath),
    __filename: scriptPath,
    console: {
      ...console,
      error: (message) => errors.push(String(message)),
    },
    process: {
      ...process,
      env: {
        CHANNEL: "stable",
        TAG: "",
        RELEASE_URL: "https://example.com/release",
        STABLE_WEBHOOK: "https://discord.example/stable",
      },
      exit: (code) => {
        exitCode = code;
      },
    },
    Buffer,
    setTimeout,
    clearTimeout,
    Promise,
  };

  vm.runInNewContext(source, sandbox, { filename: scriptPath });

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(errors, ["Missing TAG environment variable."]);
  assert.equal(exitCode, 1);
});
