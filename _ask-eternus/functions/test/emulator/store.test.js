// Firestore emulator only (demo- project): the Admin SDK rate limiter under concurrency.
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { test } from 'node:test';
import { RUNTIME_DEFAULTS } from '../../src/config.js';
import { firestoreStore, replayDocId, reserve } from '../../src/ratelimit.js';

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'emulator only');
const db = getFirestore(initializeApp({ projectId: 'demo-ask-eternus' }, 'store-test'));
const store = firestoreStore(db);

test('concurrent requests never exceed the global daily cap', async () => {
  const now = new Date('2026-10-06T10:00:00Z');
  const cfg = { ...RUNTIME_DEFAULTS, enabled: true, dailyLimit: 5, globalPerMinute: 1000 };
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => reserve(store, `client${i}`, now, cfg)));
  assert.equal(results.filter((r) => r.allowed).length, 5);
  assert.ok(results.filter((r) => !r.allowed).every((r) => r.scope === 'global_day'));
  const g = await db.doc('askRateLimits/g_d20261006').get();
  assert.equal(g.get('count'), 5);
});

test('per-client minute limit holds under concurrency, and counters store a TTL timestamp', async () => {
  const now = new Date('2026-10-07T11:00:00Z');
  const cfg = { ...RUNTIME_DEFAULTS, enabled: true };
  const results = await Promise.all(Array.from({ length: 8 }, () => reserve(store, 'sameclient', now, cfg)));
  assert.equal(results.filter((r) => r.allowed).length, 3);
  const doc = await db.doc('askRateLimits/c_sameclient_m202610071100').get();
  assert.equal(doc.get('count'), 3);
  assert.ok(doc.get('expiresAt') instanceof Timestamp);
  assert.equal(doc.get('expiresAt').toMillis(), now.getTime() + 48 * 3600 * 1000);
  assert.deepEqual(Object.keys(doc.data()).sort(), ['count', 'expiresAt']);
});

test('replay claim: exactly one of 10 concurrent claims of the same token wins', async () => {
  const id = replayDocId('1:000000000000:web:demoasketernus', 'jti-concurrency');
  const expiresAt = new Date('2026-10-06T10:10:00Z');
  const results = await Promise.all(Array.from({ length: 10 }, () => store.claimOnce(id, expiresAt)));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await store.claimOnce(id, expiresAt), false, 'a later replay still loses');
  const doc = await db.doc(`askRateLimits/${id}`).get();
  assert.ok(doc.get('expiresAt') instanceof Timestamp);
  assert.equal(doc.get('expiresAt').toMillis(), expiresAt.getTime());
  assert.deepEqual(Object.keys(doc.data()), ['expiresAt']);
});
