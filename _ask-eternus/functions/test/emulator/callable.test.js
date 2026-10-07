// Full request path through the real exported callable against the Firestore emulator.
// Token verification is replaced by the firebase-functions debug feature `skipTokenVerification`
// (emulator/testing only; it can never be set in production) so a locally built token reaches our
// handler. Every case here stops BEFORE the model: no Vertex call can be made.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'emulator only');
const FUNCTIONS_DIR = join(fileURLToPath(import.meta.url), '..', '..', '..');
const APP_ID = '1:000000000000:web:demoasketernus';
Object.assign(process.env, {
  GCLOUD_PROJECT: 'demo-ask-eternus',
  FIREBASE_DEBUG_MODE: 'true',
  FIREBASE_DEBUG_FEATURES: JSON.stringify({ skipTokenVerification: true }),
  ASK_ETERNUS_APP_ID: APP_ID,
  ASK_ETERNUS_SERVICE_ACCOUNT: 'test@demo-ask-eternus.iam.gserviceaccount.com',
  RATE_LIMIT_IP_SOURCE: 'first',
  RATE_LIMIT_HMAC_KEY: 'h'.repeat(48),
});

const require = createRequire(join(FUNCTIONS_DIR, 'package.json'));
const express = require('express');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
let server;
let url;
const admin = getFirestore(initializeApp({ projectId: 'demo-ask-eternus' }, 'callable-test'));

before(async () => {
  const { askEternus } = await import(pathToFileURL(join(FUNCTIONS_DIR, 'index.js')).href);
  const app = express();
  app.use(express.json());
  app.all(/.*/, (req, res) => askEternus(req, res));
  server = app.listen(0);
  url = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// Like a real limited-use token: fresh jti, exp 5 minutes after issue.
const token = (appId = APP_ID) => `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ app_id: appId, sub: appId, jti: randomUUID(), exp: Math.floor(Date.now() / 1000) + 300 })}.sig`;
async function ask(data, { origin = 'https://myeternusapp.com', appId, appCheck = token(appId) } = {}) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, 'x-firebase-appcheck': appCheck, 'x-forwarded-for': '192.0.2.10' },
    body: JSON.stringify({ data }),
  });
  const j = await r.json();
  return { status: r.status, body: j.result ?? j.error };
}

test('kill switch: with no config document Ask Eternus answers "unavailable" (enabled:false default)', async () => {
  await admin.doc('config/askEternus').delete();
  const r = await ask({ question: 'What is Circle?', locale: 'pt', v: 1 });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.ok, r.body.kind, r.body.language], [false, 'unavailable', 'pt']);
  assert.match(r.body.answer, /support@myeternusapp\.com/);
});

test('origin and app id are checked by our handler after App Check', async () => {
  assert.equal((await ask({ question: 'x' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await ask({ question: 'x' }, { appId: '1:999:web:other' })).status, 401);
});

test('replay record: the same App Check token is answered only once (real Firestore create)', async () => {
  const appCheck = token();
  const first = await ask({ question: 'What is Circle?', v: 1 }, { appCheck });
  assert.equal(first.status, 200);
  const replay = await ask({ question: 'What is Circle?', v: 1 }, { appCheck });
  assert.equal(replay.status, 401);
});

test('enabled: invalid input is answered before rate limiting or the model', async () => {
  await admin.doc('config/askEternus').set({ enabled: true, dailyLimit: 75 });
  await new Promise((r) => setTimeout(r, 31_000)); // runtime config cache (30 s)
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const before = (await admin.doc(`askRateLimits/g_d${day}`).get()).get('count') ?? 0;
  const r = await ask({ question: 'x'.repeat(501), v: 1 });
  assert.deepEqual([r.status, r.body.kind], [200, 'invalid_input']);
  const afterCount = (await admin.doc(`askRateLimits/g_d${day}`).get()).get('count') ?? 0;
  assert.equal(afterCount, before, 'rejected input does not consume the daily cap');
  await admin.doc('config/askEternus').delete();
});
