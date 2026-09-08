import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const serviceWorkerSource = readFileSync(resolve(repoRoot, 'frontend/public/sw.js'), 'utf8');

function loadServiceWorker() {
  const listeners = new Map();
  const context = {
    URL,
    Response,
    fetch: async () => {
      throw new Error('offline');
    },
    caches: {
      delete: async () => true,
      keys: async () => [],
      match: async () => new Response(JSON.stringify({ status: 'ready' })),
      open: async () => ({ put: async () => {}, addAll: async () => {} }),
    },
    self: {
      location: { origin: 'https://app.test' },
      addEventListener: (type, handler) => listeners.set(type, handler),
      clients: { claim: async () => {} },
      skipWaiting: async () => {},
    },
  };

  vm.runInNewContext(serviceWorkerSource, context);
  return listeners.get('fetch');
}

test('service worker does not serve stale operational status while offline', async () => {
  const handleFetch = loadServiceWorker();
  let responsePromise;
  handleFetch({
    request: {
      method: 'GET',
      mode: 'cors',
      url: 'https://app.test/api/data/status',
    },
    respondWith: (promise) => {
      responsePromise = promise;
    },
  });

  assert.equal(responsePromise, undefined);
});

test('service worker does not serve stale game-data state while offline', async () => {
  const handleFetch = loadServiceWorker();
  let responsePromise;
  handleFetch({
    request: {
      method: 'GET',
      mode: 'cors',
      url: 'https://app.test/api/game-data/state',
    },
    respondWith: (promise) => {
      responsePromise = promise;
    },
  });

  assert.equal(responsePromise, undefined);
});
