import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RUNTIME_DEFAULTS, sanitizeRuntimeConfig } from '../../src/config.js';
import { buckets, clientIp, clientKey, memoryStore, normalizeIp, replayDocId, reserve, xffDiagnostic } from '../../src/ratelimit.js';

const SECRET = 's'.repeat(40);
const cfg = { ...RUNTIME_DEFAULTS, enabled: true };

test('client IP comes from the configured X-Forwarded-For position; missing or invalid fails closed', () => {
  assert.equal(clientIp('203.0.113.7, 198.51.100.9', 'first'), '203.0.113.7');
  assert.equal(clientIp('203.0.113.7, 198.51.100.9', 'last'), '198.51.100.9');
  assert.equal(clientIp('', 'first'), null);
  assert.equal(clientIp(undefined, 'last'), null);
  assert.equal(clientIp('not-an-ip', 'first'), null);
  assert.throws(() => clientIp('1.2.3.4', 'middle'), /RATE_LIMIT_IP_SOURCE/);
});

test('IPv6 is keyed by its /64 prefix; mapped IPv4 and ports are normalized', () => {
  assert.equal(normalizeIp('2001:db8:abcd:12:1:2:3:4'), '2001:0db8:abcd:0012::/64');
  assert.equal(normalizeIp('2001:db8:abcd:12::99'), '2001:0db8:abcd:0012::/64');
  assert.equal(normalizeIp('[2001:db8::1]:443'), '2001:0db8:0000:0000::/64');
  assert.equal(normalizeIp('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(normalizeIp('192.0.2.1:8080'), '192.0.2.1');
});

test('the client key is an HMAC that rotates daily and never contains the IP', () => {
  const ip = '203.0.113.7';
  const d1 = clientKey(ip, SECRET, new Date('2026-10-06T10:00:00Z'));
  assert.match(d1, /^[0-9a-f]{32}$/);
  assert.equal(d1, clientKey(ip, SECRET, new Date('2026-10-06T23:59:59Z')));
  assert.notEqual(d1, clientKey(ip, SECRET, new Date('2026-10-07T00:00:00Z')));
  assert.notEqual(d1, clientKey(ip, 't'.repeat(40), new Date('2026-10-06T10:00:00Z')));
  assert.ok(!d1.includes('203'));
  assert.throws(() => clientKey(ip, 'short'), /HMAC/);
});

test('per-client limits: 3/minute, 15/hour, 40/day', async () => {
  const store = memoryStore();
  let t = Date.parse('2026-10-06T10:00:00Z');
  const ask = () => reserve(store, 'k', new Date(t), cfg);
  for (let i = 0; i < 3; i++) assert.equal((await ask()).allowed, true);
  const r = await ask();
  assert.deepEqual([r.allowed, r.scope], [false, 'client_minute']);
  assert.ok(r.retryAfterSeconds > 0 && r.retryAfterSeconds <= 60);
  let allowed = 3;
  for (let m = 1; m < 60 && allowed < 15; m++) { t += 60_000; while ((await ask()).allowed) allowed++; }
  assert.equal(allowed, 15);
  t += 60_000;
  assert.equal((await ask()).scope, 'client_hour');
});

test('global daily cap and per-minute cap apply across clients; rejected requests do not count', async () => {
  const store = memoryStore();
  const now = new Date('2026-10-06T10:00:00Z');
  const small = { ...cfg, dailyLimit: 5, globalPerMinute: 100 };
  for (let i = 0; i < 5; i++) assert.equal((await reserve(store, `client${i}`, now, small)).allowed, true);
  const r = await reserve(store, 'another', now, small);
  assert.deepEqual([r.allowed, r.scope], [false, 'global_day']);
  assert.equal(store.docs.get('g_d20261006').count, 5);
  const perMin = { ...cfg, dailyLimit: 1000, globalPerMinute: 2 };
  const s2 = memoryStore();
  await reserve(s2, 'a', now, perMin); await reserve(s2, 'b', now, perMin);
  assert.equal((await reserve(s2, 'c', now, perMin)).scope, 'global_minute');
});

test('counters carry a 48 h TTL and only hashed keys', async () => {
  const store = memoryStore();
  const now = new Date('2026-10-06T10:00:00Z');
  await reserve(store, 'abc123', now, cfg);
  for (const [id, doc] of store.docs) {
    assert.match(id, /^(c_abc123_[mhd]\d+|g_[md]\d+)$/);
    assert.equal(doc.expiresAt.getTime(), now.getTime() + 48 * 3600 * 1000);
  }
  assert.equal(buckets('k', now, cfg).length, 5);
});

test('replay record ids: stable SHA-256 of app id and jti, never the jti; one claim per id', async () => {
  const id = replayDocId('1:123:web:abc', 'jti-secret-value');
  assert.match(id, /^r_[0-9a-f]{64}$/);
  assert.ok(!id.includes('jti-secret-value'));
  assert.equal(replayDocId('1:123:web:abc', 'jti-secret-value'), id);
  assert.notEqual(replayDocId('1:123:web:other', 'jti-secret-value'), id);
  assert.notEqual(replayDocId('1:123:web:abc', 'jti-other'), id);
  const store = memoryStore();
  const exp = new Date('2026-10-06T10:10:00Z');
  assert.equal(await store.claimOnce(id, exp), true);
  assert.equal(await store.claimOnce(id, exp), false);
  assert.deepEqual(store.docs.get(id), { expiresAt: exp });
});

test('runtime config: missing or invalid values fail closed to the approved defaults', () => {
  assert.deepEqual(sanitizeRuntimeConfig(undefined), { enabled: false, dailyLimit: 75, globalPerMinute: 30, perClient: { minute: 3, hour: 15, day: 40 } });
  assert.equal(sanitizeRuntimeConfig({ enabled: 'true' }).enabled, false);
  assert.equal(sanitizeRuntimeConfig({ enabled: true, dailyLimit: -1 }).dailyLimit, 75);
  assert.deepEqual(sanitizeRuntimeConfig({ perClient: { minute: 100 } }).perClient, { minute: 100, hour: 15, day: 40 });
});

test('X-Forwarded-For diagnostic exposes only a count and a TEST-NET flag', () => {
  assert.deepEqual(xffDiagnostic('203.0.113.7, 198.51.100.4'), { xffEntries: 2, xffFirstTestNet: 'yes' });
  assert.deepEqual(xffDiagnostic('8.8.8.8'), { xffEntries: 1, xffFirstTestNet: 'no' });
  assert.deepEqual(xffDiagnostic(undefined), { xffEntries: 0, xffFirstTestNet: 'no' });
});
