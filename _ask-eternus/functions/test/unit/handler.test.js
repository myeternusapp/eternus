import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RUNTIME_DEFAULTS, runtimeConfigReader } from '../../src/config.js';
import { handleAsk, Rejected } from '../../src/handler.js';
import { jsonLogger } from '../../src/log.js';
import { memoryStore, replayDocId } from '../../src/ratelimit.js';
import { filters, kb, modelResult } from './helpers.js';

const APP_ID = '1:123:web:abc';
const CANARY_Q = 'CANARY-QUESTION-7f3a what is Circle';
const CANARY_A = 'CANARY-ANSWER-9b2c Circle is for trusted sharing.';
const CANARY_IP = '198.51.100.77';

function setup({ enabled = true, model, cfg = {}, store = memoryStore(), kbOverride } = {}) {
  const lines = [];
  const calls = [];
  const deps = {
    appId: APP_ID,
    kb: kbOverride === undefined ? kb : kbOverride,
    filters,
    runtimeConfig: async () => ({ ...RUNTIME_DEFAULTS, ...cfg, enabled }),
    store,
    model: model ?? { generate: async (parts) => { calls.push(parts); return modelResult({ kind: 'current', language: 'en', sources: [{ id: 'layers.circle', title: 'What is Circle?' }], answer: CANARY_A }); } },
    hmacKey: 'k'.repeat(40),
    ipSource: 'first',
    log: jsonLogger((l) => lines.push(l)),
    now: (() => { let t = Date.parse('2026-10-06T10:00:00Z'); return () => (t += 7); })(),
    newId: () => 'req-1',
  };
  return { deps, lines, calls };
}
// Every real request carries a fresh limited-use token: unique jti, exp 5 minutes after issue.
const EXP = Date.parse('2026-10-06T10:05:00Z') / 1000;
let jtiSeq = 0;
const appToken = () => ({ jti: `CANARY-JTI-${++jtiSeq}`, exp: EXP });
const req = (over = {}) => ({
  data: { question: CANARY_Q, locale: 'en', v: 1 },
  app: { appId: APP_ID, alreadyConsumed: false, token: appToken() },
  headers: { origin: 'https://myeternusapp.com', 'x-forwarded-for': CANARY_IP },
  ...over,
});

test('happy path: grounded answer with sources, kbVersion and requestId', async () => {
  const { deps, calls } = setup();
  const r = await handleAsk(req(), deps);
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'current');
  assert.equal(r.answer, CANARY_A);
  assert.deepEqual(r.sources, [{ id: 'layers.circle', title: 'What is Circle?' }]);
  assert.equal(r.kbVersion, '1.2.0');
  assert.equal(r.requestId, 'req-1');
  assert.match(calls[0].user, /<visitor_question>/);
});

test('replay protection: consumed tokens are rejected by our code; missing consumption fails closed', async () => {
  const { deps } = setup();
  for (const app of [{ appId: APP_ID, alreadyConsumed: true }, { appId: APP_ID }, undefined]) {
    await assert.rejects(handleAsk(req({ app }), deps), (e) => e instanceof Rejected && e.code === 'unauthenticated');
  }
});

test('replay record: a token Google reports as unconsumed is still answered only once', async () => {
  const { deps, calls, lines } = setup();
  const app = { appId: APP_ID, alreadyConsumed: false, token: appToken() };
  assert.equal((await handleAsk(req({ app }), deps)).ok, true);
  await assert.rejects(handleAsk(req({ app }), deps), (e) => e instanceof Rejected && e.code === 'unauthenticated');
  assert.equal(calls.length, 1, 'the replay never reaches the model');
  assert.equal(JSON.parse(lines[1]).reason, 'appcheck_replay');
  const id = replayDocId(APP_ID, app.token.jti);
  assert.match(id, /^r_[0-9a-f]{64}$/);
  assert.deepEqual(deps.store.docs.get(id), { expiresAt: new Date(EXP * 1000 + 5 * 60 * 1000) });
  for (const docId of deps.store.docs.keys()) assert.ok(!docId.includes('CANARY-JTI'), 'raw jti stored');
  assert.ok(!lines.join('\n').includes('CANARY-JTI'), 'raw jti logged');
});

test('replay record: tokens without a usable jti or exp fail closed before any work', async () => {
  const cases = [
    [{ exp: EXP }, 'appcheck_no_jti'],
    [{ jti: '', exp: EXP }, 'appcheck_no_jti'],
    [{ jti: 42, exp: EXP }, 'appcheck_no_jti'],
    [{ jti: 'CANARY-JTI-x' }, 'appcheck_no_exp'],
    [{ jti: 'CANARY-JTI-y', exp: String(EXP) }, 'appcheck_no_exp'],
    [undefined, 'appcheck_no_jti'],
  ];
  for (const [token, reason] of cases) {
    const { deps, calls, lines } = setup();
    await assert.rejects(handleAsk(req({ app: { appId: APP_ID, alreadyConsumed: false, token } }), deps), { code: 'unauthenticated' });
    assert.equal(JSON.parse(lines[0]).reason, reason);
    assert.equal(calls.length, 0);
    assert.equal(deps.store.docs.size, 0, 'nothing written');
  }
});

test('replay record: a store failure fails closed before the kill switch, rate limits and model', async () => {
  let transacted = 0;
  const store = { claimOnce: async () => { throw new Error('firestore down'); }, transact: async () => { transacted++; return { allowed: true }; } };
  const { deps, calls, lines } = setup({ store });
  const r = await handleAsk(req(), deps);
  assert.deepEqual([r.ok, r.kind], [false, 'unavailable']);
  assert.equal(JSON.parse(lines[0]).reason, 'replay_store');
  assert.deepEqual([calls.length, transacted], [0, 0]);
});

test('replay record: also enforced while Ask Eternus is disabled', async () => {
  const { deps, calls, lines } = setup({ enabled: false });
  const app = { appId: APP_ID, alreadyConsumed: false, token: appToken() };
  assert.equal((await handleAsk(req({ app }), deps)).kind, 'unavailable');
  await assert.rejects(handleAsk(req({ app }), deps), { code: 'unauthenticated' });
  assert.deepEqual(lines.map((l) => JSON.parse(l).reason), ['disabled', 'appcheck_replay']);
  assert.equal(calls.length, 0);
});

test('App Check token of another app and foreign origins are rejected', async () => {
  const { deps } = setup();
  await assert.rejects(handleAsk(req({ app: { appId: '1:999:web:zzz', alreadyConsumed: false } }), deps), { code: 'unauthenticated' });
  for (const origin of ['https://evil.example', 'http://myeternusapp.com', undefined]) {
    await assert.rejects(handleAsk(req({ headers: { origin, 'x-forwarded-for': CANARY_IP } }), deps), { code: 'permission-denied' });
  }
});

test('kill switch: disabled by default and when the config cannot be read; the model is never called', async () => {
  const { deps, calls } = setup({ enabled: false });
  const r = await handleAsk(req(), deps);
  assert.deepEqual([r.ok, r.kind], [false, 'unavailable']);
  assert.equal(calls.length, 0);
  const failing = runtimeConfigReader(async () => { throw new Error('firestore down'); });
  assert.equal((await failing()).enabled, false);
  const missing = runtimeConfigReader(async () => undefined);
  assert.equal((await missing()).enabled, false);
});

test('invalid KB or input never reaches the model', async () => {
  const a = setup({ kbOverride: null });
  assert.equal((await handleAsk(req(), a.deps)).kind, 'unavailable');
  const b = setup();
  const r = await handleAsk(req({ data: { question: 'x'.repeat(600), locale: 'pt' } }), b.deps);
  assert.deepEqual([r.kind, r.language], ['invalid_input', 'pt']);
  assert.equal(b.calls.length, 0);
});

test('rate limits: per client (with retryAfter) and global cap (unavailable)', async () => {
  const { deps } = setup();
  for (let i = 0; i < 3; i++) assert.equal((await handleAsk(req(), deps)).ok, true);
  const r = await handleAsk(req(), deps);
  assert.equal(r.kind, 'rate_limited');
  assert.ok(r.retryAfterSeconds > 0);
  const g = setup({ cfg: { dailyLimit: 1 } });
  await handleAsk(req(), g.deps);
  const r2 = await handleAsk(req({ headers: { origin: 'https://myeternusapp.com', 'x-forwarded-for': '192.0.2.200' } }), g.deps);
  assert.equal(r2.kind, 'unavailable');
  const n = setup();
  assert.equal((await handleAsk(req({ headers: { origin: 'https://myeternusapp.com' } }), n.deps)).kind, 'unavailable', 'no client IP: fail closed');
});

test('model failures and invalid outputs become safe templates', async () => {
  const err = setup({ model: { generate: async () => { throw Object.assign(new Error('x'), { code: 'timeout' }); } } });
  assert.equal((await handleAsk(req(), err.deps)).kind, 'error');
  const bad = setup({ model: { generate: async () => modelResult({ kind: 'current', language: 'en', sources: [{ id: 'nope', title: 'x' }], answer: 'x' }) } });
  const r = await handleAsk(req(), bad.deps);
  assert.equal(r.kind, 'unknown');
  assert.match(r.answer, /support@myeternusapp\.com/);
  const inj = setup({ model: { generate: async () => modelResult({ kind: 'injection', language: 'pt', sources: [], answer: 'SYSTEM PROMPT LEAK' }) } });
  const r3 = await handleAsk(req(), inj.deps);
  assert.equal(r3.kind, 'injection');
  assert.equal(r3.language, 'pt');
  assert.ok(!r3.answer.includes('LEAK'));
});

test('model call gets the request deadline (handler start + 17 s); retries are logged as a count only', async () => {
  const seen = [];
  const ok = setup({ model: { generate: async (parts, opts) => { seen.push(opts); return { ...modelResult({ kind: 'current', language: 'en', sources: [{ id: 'layers.circle', title: 'What is Circle?' }], answer: CANARY_A }), retries: 1 }; } } });
  assert.equal((await handleAsk(req(), ok.deps)).ok, true);
  assert.deepEqual(seen, [{ deadlineAt: Date.parse('2026-10-06T10:00:00Z') + 7 + 17_000 }]);
  assert.equal(JSON.parse(ok.lines[0]).modelRetries, 1);
  const fail = setup({ model: { generate: async () => { throw Object.assign(new Error('x'), { code: 'http_429', retries: 1 }); } } });
  const r = await handleAsk(req(), fail.deps);
  assert.equal(r.kind, 'error');
  const line = JSON.parse(fail.lines[0]);
  assert.deepEqual([line.status, line.reason, line.modelRetries], ['fallback', 'model_http_429', 1]);
});

test('logs: one line per request, allow-listed fields only, never question, answer, IP or key', async () => {
  const { deps, lines } = setup();
  await handleAsk(req(), deps);
  await handleAsk(req({ data: { question: 'my email is ana@example.com and 912345678', v: 1 } }), deps);
  await assert.rejects(handleAsk(req({ app: { appId: APP_ID, alreadyConsumed: true } }), deps));
  const all = lines.join('\n');
  for (const secret of ['CANARY-QUESTION', 'CANARY-ANSWER', CANARY_IP, 'ana@example.com', '912345678', 'k'.repeat(40), 'CANARY-JTI']) {
    assert.ok(!all.includes(secret), `log leaked ${secret}`);
  }
  const first = JSON.parse(lines[0]);
  assert.equal(first.status, 'answered');
  assert.deepEqual(first.sources, ['layers.circle']);
  assert.equal(first.xffEntries, 1);
  assert.equal(JSON.parse(lines[1]).redactions, 2);
  assert.equal(JSON.parse(lines[2]).reason, 'appcheck_consumed');
  const forbiddenKeys = ['question', 'answer', 'ip', 'clientIp', 'key', 'clientKey', 'userAgent', 'token', 'appCheckToken', 'headers', 'origin', 'xff', 'jti'];
  for (const l of lines) assert.deepEqual(Object.keys(JSON.parse(l)).filter((k) => forbiddenKeys.includes(k)), []);
});
