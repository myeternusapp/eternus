// Exercises the real exported callable (firebase-functions 7) over local HTTP: platform-level
// App Check enforcement, CORS and the deployment options. No network, no cloud resources.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { FUNCTIONS_DIR } from './helpers.js';

process.env.GCLOUD_PROJECT ??= 'demo-ask-eternus';
const require = createRequire(join(FUNCTIONS_DIR, 'package.json'));
const express = require('express');
let server;
let url;
let askEternus;

before(async () => {
  ({ askEternus } = await import(pathToFileURL(join(FUNCTIONS_DIR, 'index.js')).href));
  const app = express();
  app.use(express.json());
  app.all(/.*/, (req, res) => askEternus(req, res));
  server = app.listen(0);
  url = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

const post = (headers, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('deployment options: europe-west1, v2, maxInstances 2, concurrency 20, 20 s, 512 MiB, HMAC secret', () => {
  const e = askEternus.__endpoint;
  assert.equal(e.platform, 'gcfv2');
  assert.deepEqual(e.region, ['europe-west1']);
  assert.equal(e.maxInstances, 2);
  assert.equal(e.concurrency, 20);
  assert.equal(e.timeoutSeconds, 20);
  assert.equal(e.availableMemoryMb, 512);
  assert.deepEqual(e.secretEnvironmentVariables.map((s) => s.key), ['RATE_LIMIT_HMAC_KEY']);
  assert.ok('callableTrigger' in e);
});

test('requests without a valid App Check token are rejected by the platform (401)', async () => {
  for (const headers of [{ origin: 'https://myeternusapp.com' }, { origin: 'https://myeternusapp.com', 'x-firebase-appcheck': 'garbage' }]) {
    const r = await post(headers, { data: { question: 'What is Circle?' } });
    assert.equal(r.status, 401);
    assert.deepEqual((await r.json()).error.status, 'UNAUTHENTICATED');
  }
});

test('CORS only ever allows https://myeternusapp.com', async () => {
  for (const origin of ['https://myeternusapp.com', 'https://evil.example', 'http://myeternusapp.com']) {
    const r = await fetch(url, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-firebase-appcheck' } });
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://myeternusapp.com');
  }
});
