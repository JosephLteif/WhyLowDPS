const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

const SCRIPT_PATH = path.resolve(__dirname, "../../backend/scripts/compact-data.js");
const { buildCompactManifest, readJson } = require(SCRIPT_PATH);

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "compact-data-test-"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

function readOutputJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadScriptForTesting({
                                scriptPath = SCRIPT_PATH,
                                dirname = path.dirname(SCRIPT_PATH),
                                requireOverride = require,
                                argv = [process.execPath, scriptPath],
                              } = {}) {
  const source = fs.readFileSync(scriptPath, "utf8");
  const module = { exports: {} };

  const sandbox = {
    require: requireOverride,
    module,
    exports: module.exports,
    __dirname: dirname,
    __filename: path.join(dirname, path.basename(scriptPath)),
    console,
    process: {
      ...process,
      argv,
      exit: (code) => {
        throw new Error(`process.exit(${code})`);
      },
    },
    Buffer,
    URL,
    setTimeout,
    clearTimeout,
    Promise,
  };

  vm.runInNewContext(
    `${source}
module.exports.__testables = {
  loadDataManifest,
  compactItems,
  downloadFile,
  compactInstances,
  pickFields,
  compactFile,
  fmt,
  main,
};`,
    sandbox,
    { filename: sandbox.__filename }
  );

  return module.exports.__testables;
}

function createFakeHttpModule(handler) {
  return {
    get(url, callback) {
      const request = new EventEmitter();

      request.setTimeout = (ms, timeoutCallback) => {
        request.__timeoutCallback = timeoutCallback;
        return request;
      };

      request.destroy = () => {
        request.destroyed = true;
      };

      process.nextTick(() => handler(url, callback, request));
      return request;
    },
  };
}

function createResponse({ statusCode = 200, headers = {}, body = "" } = {}) {
  const response = new EventEmitter();

  response.statusCode = statusCode;
  response.headers = headers;

  response.resume = () => {
    response.resumed = true;
  };

  response.pipe = (destination) => {
    process.nextTick(() => {
      destination.write(body);
      destination.end();
    });

    return destination;
  };

  return response;
}

test("buildCompactManifest maps supported compact modes", () => {
  const manifest = buildCompactManifest([
    { local_path: "a.json", compact_mode: "copy" },
    { local_path: "b.json", compact_mode: "fields", compact_fields: ["id", "name"] },
    { local_path: "c.json", compact_mode: "custom_items" },
    { local_path: "d.json", compact_mode: "custom_instances" },
  ]);

  assert.deepEqual(manifest["a.json"], null);
  assert.deepEqual(manifest["b.json"], { fields: ["id", "name"] });
  assert.deepEqual(manifest["c.json"], { custom: true });
  assert.deepEqual(manifest["d.json"], { custom: true, handler: "instances" });
});

test("buildCompactManifest skips null, malformed, and missing mode entries", () => {
  const manifest = buildCompactManifest([
    null,
    undefined,
    {},
    { local_path: 123, compact_mode: "copy" },
    { local_path: "missing-mode.json" },
    { local_path: "known.json", compact_mode: "copy" },
  ]);

  assert.deepEqual(manifest, {
    "known.json": null,
  });
});

test("buildCompactManifest falls back to empty fields for invalid compact_fields", () => {
  const manifest = buildCompactManifest([
    {
      local_path: "fields.json",
      compact_mode: "fields",
      compact_fields: "id,name",
    },
  ]);

  assert.deepEqual(manifest, {
    "fields.json": { fields: [] },
  });
});

test("buildCompactManifest skips unknown modes and logs a warning", () => {
  const originalWarn = console.warn;
  const warnings = [];

  console.warn = (message) => warnings.push(message);

  try {
    const manifest = buildCompactManifest([
      { local_path: "known.json", compact_mode: "copy" },
      { local_path: "unknown.json", compact_mode: "mystery-mode" },
    ]);

    assert.deepEqual(Object.keys(manifest), ["known.json"]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /SKIP unknown\.json/);
    assert.match(warnings[0], /mystery-mode/);
  } finally {
    console.warn = originalWarn;
  }
});

test("readJson parses valid JSON and trims whitespace", () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, "valid.json");

  fs.writeFileSync(filePath, '\n  {"ok": true, "items": [1, 2]}  \n');

  assert.deepEqual(readJson(filePath), {
    ok: true,
    items: [1, 2],
  });
});

test("readJson throws descriptive error for missing file", () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, "missing.json");

  assert.throws(() => readJson(filePath), /File "missing\.json" does not exist/);
});

test("readJson throws descriptive error for XML responses", () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, "bad.json");

  fs.writeFileSync(filePath, '<?xml version="1.0"?><error />');

  assert.throws(() => readJson(filePath), /XML\/HTML, not JSON/);
});

test("readJson throws descriptive error for DOCTYPE HTML responses", () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, "bad.json");

  fs.writeFileSync(filePath, "<!DOCTYPE html><html><body>404</body></html>");

  assert.throws(() => readJson(filePath), /XML\/HTML, not JSON/);
});

test("readJson throws descriptive error for lowercase HTML responses", () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, "bad.json");

  fs.writeFileSync(filePath, "<html><body>404</body></html>");

  assert.throws(() => readJson(filePath), /XML\/HTML, not JSON/);
});

test("readJson throws descriptive error for malformed JSON and includes snippet", () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, "bad.json");

  fs.writeFileSync(filePath, "{not-json");

  assert.throws(() => readJson(filePath), (error) => {
    assert.match(error.message, /Failed to parse "bad\.json" as JSON/);
    assert.match(error.message, /Snippet: \{not-json/);
    return true;
  });
});

test("loadDataManifest returns manifest files from expected resources path", () => {
  const dir = makeTempDir();
  const scriptsDir = path.join(dir, "backend", "scripts");
  const resourcesDir = path.join(dir, "backend", "resources");

  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });

  writeJson(path.join(resourcesDir, "data-manifest.json"), {
    files: [{ local_path: "a.json", compact_mode: "copy" }],
  });

  const { loadDataManifest } = loadScriptForTesting({
    dirname: scriptsDir,
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(loadDataManifest())),
    [{ local_path: "a.json", compact_mode: "copy" }]
  );
});

test("loadDataManifest rejects missing manifest", () => {
  const dir = makeTempDir();
  const scriptsDir = path.join(dir, "backend", "scripts");

  fs.mkdirSync(scriptsDir, { recursive: true });

  const { loadDataManifest } = loadScriptForTesting({
    dirname: scriptsDir,
  });

  assert.throws(() => loadDataManifest(), /Data manifest not found/);
});

test("loadDataManifest rejects invalid manifest shape", () => {
  const dir = makeTempDir();
  const scriptsDir = path.join(dir, "backend", "scripts");
  const resourcesDir = path.join(dir, "backend", "resources");

  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });

  writeJson(path.join(resourcesDir, "data-manifest.json"), {
    files: "not-array",
  });

  const { loadDataManifest } = loadScriptForTesting({
    dirname: scriptsDir,
  });

  assert.throws(() => loadDataManifest(), /Invalid data manifest shape/);
});

test("pickFields keeps only requested fields that exist", () => {
  const { pickFields } = loadScriptForTesting();

  assert.deepEqual(
    JSON.parse(JSON.stringify(
      pickFields(
        { id: 1, name: "Sword", extra: "drop-me" },
        ["id", "name", "missing"]
      )
    )),
    { id: 1, name: "Sword" }
  );
});

test("compactFile copies and minifies whole JSON when config is null", async () => {
  const { compactFile } = loadScriptForTesting();

  const dir = makeTempDir();
  const input = path.join(dir, "input.json");
  const output = path.join(dir, "output.json");

  fs.writeFileSync(
    input,
    JSON.stringify({ b: 2, nested: { a: 1 } }, null, 2)
  );

  await compactFile(input, output, null, dir, dir);

  assert.equal(
    fs.readFileSync(output, "utf8"),
    JSON.stringify({ b: 2, nested: { a: 1 } })
  );
});

test("compactFile filters, picks fields, and transforms array entries", async () => {
  const { compactFile } = loadScriptForTesting();

  const dir = makeTempDir();
  const input = path.join(dir, "input.json");
  const output = path.join(dir, "output.json");

  writeJson(input, [
    { id: 1, name: "Keep", enabled: true, ignored: "x" },
    { id: 2, name: "Drop", enabled: false, ignored: "y" },
  ]);

  await compactFile(
    input,
    output,
    {
      fields: ["id", "name"],
      filter: (item) => item.enabled,
      transform: (item) => ({
        ...item,
        name: item.name.toUpperCase(),
      }),
    },
    dir,
    dir
  );

  assert.deepEqual(readOutputJson(output), [
    { id: 1, name: "KEEP" },
  ]);
});

test("compactFile picks fields from object values keyed by id", async () => {
  const { compactFile } = loadScriptForTesting();

  const dir = makeTempDir();
  const input = path.join(dir, "input.json");
  const output = path.join(dir, "output.json");

  writeJson(input, {
    100: { id: 100, name: "A", extra: true },
    200: { id: 200, name: "B", extra: true },
  });

  await compactFile(input, output, { fields: ["id"] }, dir, dir);

  assert.deepEqual(readOutputJson(output), {
    100: { id: 100 },
    200: { id: 200 },
  });
});

test("compactFile leaves scalar and array object values unchanged", async () => {
  const { compactFile } = loadScriptForTesting();

  const dir = makeTempDir();
  const input = path.join(dir, "input.json");
  const output = path.join(dir, "output.json");

  writeJson(input, {
    scalar: 123,
    array: [{ id: 1, extra: true }],
    object: { id: 2, extra: true },
  });

  await compactFile(input, output, { fields: ["id"] }, dir, dir);

  assert.deepEqual(readOutputJson(output), {
    scalar: 123,
    array: [{ id: 1, extra: true }],
    object: { id: 2 },
  });
});

test("compactItems keeps drop fields for current expansion items and strips source details", () => {
  const { compactItems } = loadScriptForTesting();

  const dir = makeTempDir();
  const input = path.join(dir, "items.json");
  const output = path.join(dir, "items.compact.json");

  writeJson(input, [
    {
      id: 1,
      name: "Old World Drop",
      icon: "old-icon",
      quality: 3,
      itemLevel: 100,
      itemClass: 4,
      itemSubClass: 1,
      inventoryType: 5,
      expansion: 9,
      sources: [{ encounterId: 10, boss: "drop-me" }],
      specs: [262],
      extra: "drop-me",
    },
    {
      id: 2,
      name: "Current No Source",
      icon: "current-icon",
      quality: 4,
      itemLevel: 700,
      itemClass: 2,
      itemSubClass: 7,
      inventoryType: 13,
      expansion: 10,
      specs: [263],
      extra: "drop-me",
    },
    {
      id: 3,
      name: "Old Vendor Item",
      icon: "vendor-icon",
      quality: 2,
      itemLevel: 80,
      itemClass: 4,
      itemSubClass: 2,
      inventoryType: 1,
      expansion: 8,
      specs: [264],
      extra: "drop-me",
    },
  ]);

  compactItems(input, output);

  assert.deepEqual(readOutputJson(output), [
    {
      id: 1,
      name: "Old World Drop",
      icon: "old-icon",
      quality: 3,
      itemLevel: 100,
      itemClass: 4,
      itemSubClass: 1,
      inventoryType: 5,
      expansion: 9,
      sources: [{ encounterId: 10 }],
      specs: [262],
    },
    {
      id: 2,
      name: "Current No Source",
      icon: "current-icon",
      quality: 4,
      itemLevel: 700,
      itemClass: 2,
      itemSubClass: 7,
      inventoryType: 13,
      expansion: 10,
      specs: [263],
    },
    {
      id: 3,
      name: "Old Vendor Item",
      icon: "vendor-icon",
      quality: 2,
      itemLevel: 80,
      itemClass: 4,
      itemSubClass: 2,
      inventoryType: 1,
      expansion: 8,
    },
  ]);
});

test("compactItems handles an empty item list", () => {
  const { compactItems } = loadScriptForTesting();

  const dir = makeTempDir();
  const input = path.join(dir, "items.json");
  const output = path.join(dir, "items.compact.json");

  writeJson(input, []);

  compactItems(input, output);

  assert.deepEqual(readOutputJson(output), []);
});

test("compactFile delegates to compactItems for custom item config", async () => {
  const { compactFile } = loadScriptForTesting();

  const dir = makeTempDir();
  const input = path.join(dir, "items.json");
  const output = path.join(dir, "items.compact.json");

  writeJson(input, [
    {
      id: 1,
      name: "Item",
      expansion: 1,
      sources: [],
      ignored: true,
    },
  ]);

  await compactFile(input, output, { custom: true }, dir, dir);

  assert.deepEqual(readOutputJson(output), [
    { id: 1, name: "Item", expansion: 1, sources: [] },
  ]);
});

test("compactInstances uses Blizzard instance and encounter image URLs when downloads succeed", async () => {
  const httpMock = createFakeHttpModule((url, callback) => {
    callback(createResponse({ body: `image:${url}` }));
  });

  const { compactInstances } = loadScriptForTesting({
    requireOverride: (name) => {
      if (name === "http" || name === "https") return httpMock;
      return require(name);
    },
  });

  const dir = makeTempDir();
  const inputDir = path.join(dir, "input");
  const outputDir = path.join(dir, "output");

  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const input = path.join(inputDir, "instances.json");
  const output = path.join(outputDir, "instances.json");

  writeJson(input, [
    {
      id: 100,
      name: "Dungeon",
      image_url: "https://fallback.example/old.jpg",
      encounters: [
        {
          id: 200,
          name: "Boss",
          image_url: "https://fallback.example/boss.jpg",
        },
      ],
    },
  ]);

  writeJson(path.join(inputDir, "blizzard-instances.json"), {
    dungeons: [
      {
        id: 100,
        image_url: "https://cdn.example/dungeon.png",
        encounters: [
          {
            id: 200,
            image_url: "https://cdn.example/boss.png",
          },
        ],
      },
    ],
    raids: [],
  });

  await compactInstances(input, output, inputDir, outputDir);

  assert.deepEqual(readOutputJson(output), [
    {
      id: 100,
      name: "Dungeon",
      image_url: "/api/data/instance-images/100.png",
      encounters: [
        {
          id: 200,
          name: "Boss",
          image_url: "/api/data/instance-images/200.png",
        },
      ],
    },
  ]);

  assert.equal(
    fs.existsSync(path.join(outputDir, "instance-images", "100.png")),
    true
  );

  assert.equal(
    fs.existsSync(path.join(outputDir, "instance-images", "200.png")),
    true
  );
});

test("compactInstances supplements missing images from season rotation", async () => {
  const httpMock = createFakeHttpModule((url, callback) => {
    callback(createResponse({ body: `image:${url}` }));
  });

  const { compactInstances } = loadScriptForTesting({
    requireOverride: (name) => {
      if (name === "http" || name === "https") return httpMock;
      return require(name);
    },
  });

  const dir = makeTempDir();
  const inputDir = path.join(dir, "input");
  const outputDir = path.join(dir, "output");

  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const input = path.join(inputDir, "instances.json");
  const output = path.join(outputDir, "instances.json");

  writeJson(input, [
    {
      id: 300,
      name: "Season Dungeon",
    },
  ]);

  writeJson(path.join(inputDir, "blizzard-season.json"), {
    mplus_rotation: [
      {
        instance_id: 300,
        image_url: "https://cdn.example/season.jpg",
      },
    ],
  });

  await compactInstances(input, output, inputDir, outputDir);

  assert.deepEqual(readOutputJson(output), [
    {
      id: 300,
      name: "Season Dungeon",
      image_url: "/api/data/instance-images/300.jpg",
    },
  ]);
});

test("compactInstances falls back to source image_url and removes broken external URLs", async () => {
  const httpMock = createFakeHttpModule((url, callback) => {
    if (url.includes("ok")) {
      callback(createResponse({ body: "image" }));
      return;
    }

    callback(createResponse({ statusCode: 404, body: "not found" }));
  });

  const { compactInstances } = loadScriptForTesting({
    requireOverride: (name) => {
      if (name === "http" || name === "https") return httpMock;
      return require(name);
    },
  });

  const dir = makeTempDir();
  const inputDir = path.join(dir, "input");
  const outputDir = path.join(dir, "output");

  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const input = path.join(inputDir, "instances.json");
  const output = path.join(outputDir, "instances.json");

  writeJson(input, [
    {
      id: 1,
      name: "Localizable",
      image_url: "https://cdn.example/ok.jpg",
    },
    {
      id: 2,
      name: "Broken",
      image_url: "https://cdn.example/missing.jpg",
    },
  ]);

  await compactInstances(input, output, inputDir, outputDir);

  assert.deepEqual(readOutputJson(output), [
    {
      id: 1,
      name: "Localizable",
      image_url: "/api/data/instance-images/1.jpg",
    },
    {
      id: 2,
      name: "Broken",
    },
  ]);
});

test("compactInstances removes broken encounter image URLs", async () => {
  const httpMock = createFakeHttpModule((url, callback) => {
    callback(createResponse({ statusCode: 404, body: "not found" }));
  });

  const { compactInstances } = loadScriptForTesting({
    requireOverride: (name) => {
      if (name === "http" || name === "https") return httpMock;
      return require(name);
    },
  });

  const dir = makeTempDir();
  const inputDir = path.join(dir, "input");
  const outputDir = path.join(dir, "output");

  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const input = path.join(inputDir, "instances.json");
  const output = path.join(outputDir, "instances.json");

  writeJson(input, [
    {
      id: 1,
      name: "Instance",
      encounters: [
        {
          id: 2,
          name: "Boss",
          image_url: "https://cdn.example/broken.jpg",
        },
      ],
    },
  ]);

  await compactInstances(input, output, inputDir, outputDir);

  assert.deepEqual(readOutputJson(output), [
    {
      id: 1,
      name: "Instance",
      encounters: [
        {
          id: 2,
          name: "Boss",
        },
      ],
    },
  ]);
});

test("compactInstances ignores malformed supplemental Blizzard files", async () => {
  const { compactInstances } = loadScriptForTesting();

  const dir = makeTempDir();
  const inputDir = path.join(dir, "input");
  const outputDir = path.join(dir, "output");

  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const input = path.join(inputDir, "instances.json");
  const output = path.join(outputDir, "instances.json");

  writeJson(input, [
    {
      id: 1,
      name: "No Image",
    },
  ]);

  fs.writeFileSync(path.join(inputDir, "blizzard-instances.json"), "{bad-json");
  fs.writeFileSync(path.join(inputDir, "blizzard-season.json"), "{bad-json");

  await compactInstances(input, output, inputDir, outputDir);

  assert.deepEqual(readOutputJson(output), [
    {
      id: 1,
      name: "No Image",
    },
  ]);
});

test("compactFile delegates to compactInstances for custom instance config", async () => {
  const { compactFile } = loadScriptForTesting();

  const dir = makeTempDir();
  const inputDir = path.join(dir, "input");
  const outputDir = path.join(dir, "output");

  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const input = path.join(inputDir, "instances.json");
  const output = path.join(outputDir, "instances.json");

  writeJson(input, [
    {
      id: 1,
      name: "Instance",
    },
  ]);

  await compactFile(
    input,
    output,
    { custom: true, handler: "instances" },
    inputDir,
    outputDir
  );

  assert.deepEqual(readOutputJson(output), [
    {
      id: 1,
      name: "Instance",
    },
  ]);
});

test("downloadFile returns true and writes body for successful HTTP responses", async () => {
  const httpMock = createFakeHttpModule((url, callback) => {
    callback(createResponse({ statusCode: 200, body: "hello" }));
  });

  const { downloadFile } = loadScriptForTesting({
    requireOverride: (name) => {
      if (name === "http") return httpMock;
      return require(name);
    },
  });

  const dir = makeTempDir();
  const dest = path.join(dir, "file.txt");

  const ok = await downloadFile("http://example.com/file.txt", dest);

  assert.equal(ok, true);
  assert.equal(fs.readFileSync(dest, "utf8"), "hello");
});

test("downloadFile follows redirects", async () => {
  const seenUrls = [];

  const httpMock = createFakeHttpModule((url, callback) => {
    seenUrls.push(url);

    if (url === "http://example.com/start") {
      callback(
        createResponse({
          statusCode: 302,
          headers: {
            location: "http://example.com/final",
          },
        })
      );
      return;
    }

    callback(createResponse({ statusCode: 200, body: "redirected" }));
  });

  const { downloadFile } = loadScriptForTesting({
    requireOverride: (name) => {
      if (name === "http") return httpMock;
      return require(name);
    },
  });

  const dir = makeTempDir();
  const dest = path.join(dir, "file.txt");

  const ok = await downloadFile("http://example.com/start", dest);

  assert.equal(ok, true);
  assert.deepEqual(seenUrls, [
    "http://example.com/start",
    "http://example.com/final",
  ]);
  assert.equal(fs.readFileSync(dest, "utf8"), "redirected");
});

test("downloadFile returns false for non-200 responses", async () => {
  const httpMock = createFakeHttpModule((url, callback) => {
    callback(createResponse({ statusCode: 500, body: "server error" }));
  });

  const { downloadFile } = loadScriptForTesting({
    requireOverride: (name) => {
      if (name === "http") return httpMock;
      return require(name);
    },
  });

  const dir = makeTempDir();
  const dest = path.join(dir, "file.txt");

  const ok = await downloadFile("http://example.com/file.txt", dest);

  assert.equal(ok, false);
  assert.equal(fs.existsSync(dest), false);
});

test("downloadFile returns false for request errors", async () => {
  const httpMock = createFakeHttpModule((url, callback, request) => {
    request.emit("error", new Error("network down"));
  });

  const { downloadFile } = loadScriptForTesting({
    requireOverride: (name) => {
      if (name === "http") return httpMock;
      return require(name);
    },
  });

  const dir = makeTempDir();
  const dest = path.join(dir, "file.txt");

  const ok = await downloadFile("http://example.com/file.txt", dest);

  assert.equal(ok, false);
});

test("fmt formats bytes, KB, and MB", () => {
  const { fmt } = loadScriptForTesting();

  assert.equal(fmt(512), "512B");
  assert.equal(fmt(1024), "1KB");
  assert.equal(fmt(1536), "2KB");
  assert.equal(fmt(1024 * 1024), "1.0MB");
  assert.equal(fmt(2.5 * 1024 * 1024), "2.5MB");
});

test("main downloads static assets and logs output directory", async () => {
  const httpMock = createFakeHttpModule((url, callback) => {
    callback(createResponse({ statusCode: 200, body: "asset" }));
  });

  const dir = makeTempDir();
  const scriptsDir = path.join(dir, "backend", "scripts");
  const resourcesDir = path.join(dir, "backend", "resources");
  const inputDir = path.join(dir, "input");
  const outputDir = path.join(dir, "output");

  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.mkdirSync(inputDir, { recursive: true });

  writeJson(path.join(resourcesDir, "data-manifest.json"), {
    files: [{ local_path: "copy.json", compact_mode: "copy" }],
  });

  writeJson(path.join(inputDir, "copy.json"), { ok: true });

  const logs = [];
  const originalLog = console.log;
  console.log = (message) => logs.push(String(message));

  try {
    const { main } = loadScriptForTesting({
      dirname: scriptsDir,
      argv: [process.execPath, path.join(scriptsDir, "compact-data.js"), inputDir, outputDir],
      requireOverride: (name) => {
        if (name === "http" || name === "https") return httpMock;
        return require(name);
      },
    });

    await main();

    assert.equal(fs.existsSync(path.join(outputDir, "copy.json")), true);
    assert.equal(fs.existsSync(path.join(outputDir, "static", "faction-alliance.png")), true);
    assert.ok(logs.some((line) => line.includes("Downloaded 4 static assets")));
    assert.ok(logs.some((line) => line.includes(`Output: ${outputDir}`)));
  } finally {
    console.log = originalLog;
  }
});
