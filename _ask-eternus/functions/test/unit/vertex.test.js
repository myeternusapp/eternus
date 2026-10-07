import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateContentUrl, parseGenerateContent, requestBody, vertexModel } from '../../src/vertex.js';

test('requests go only to the Vertex AI EU multi-region host, with the approved model', () => {
  const u = new URL(generateContentUrl('eternus-ask'));
  assert.equal(u.hostname, 'aiplatform.eu.rep.googleapis.com');
  assert.equal(u.pathname, '/v1/projects/eternus-ask/locations/eu/publishers/google/models/gemini-3.5-flash-lite:generateContent');
  assert.throws(() => generateContentUrl('../evil'), /bad_project/);
  assert.throws(() => generateContentUrl(undefined), /bad_project/);
});

test('request body: system instruction, JSON schema, minimal thinking, output cap, no explicit cache', () => {
  const b = requestBody({ system: 'SYS', user: 'USER', schema: { type: 'OBJECT' } });
  assert.deepEqual(b.systemInstruction, { parts: [{ text: 'SYS' }] });
  assert.deepEqual(b.contents, [{ role: 'user', parts: [{ text: 'USER' }] }]);
  assert.equal(b.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(b.generationConfig.responseSchema, { type: 'OBJECT' });
  assert.equal(b.generationConfig.maxOutputTokens, 600);
  assert.deepEqual(b.generationConfig.thinkingConfig, { thinkingLevel: 'MINIMAL' });
  assert.ok(!('cachedContent' in b), 'no explicit context caching');
  assert.ok(!('tools' in b), 'no tools / grounding');
});

test('the client sends a bearer token to the pinned URL and parses the answer without thoughts', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'thinking...', thought: true }, { text: '{"a":1}' }] } }],
      usageMetadata: { promptTokenCount: 10400, cachedContentTokenCount: 9000, candidatesTokenCount: 80, thoughtsTokenCount: 5 },
    }) };
  };
  const m = vertexModel({ projectId: 'eternus-ask', getAccessToken: async () => 'tok', fetch: fakeFetch });
  const r = await m.generate({ system: 'S', user: 'U', schema: {} });
  assert.equal(new URL(calls[0].url).hostname, 'aiplatform.eu.rep.googleapis.com');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.equal(r.text, '{"a":1}');
  assert.equal(r.finishReason, 'STOP');
  assert.deepEqual(r.usage, { promptTokens: 10400, cachedTokens: 9000, outputTokens: 80, thoughtTokens: 5 });
});

test('failures become coded errors that never carry content', async () => {
  const mk = (fetchImpl, extra = {}) => vertexModel({ projectId: 'eternus-ask', getAccessToken: async () => 't', fetch: fetchImpl, ...extra });
  await assert.rejects(mk(async () => ({ ok: false, status: 429 })).generate({}), { code: 'http_429' });
  await assert.rejects(mk(async () => { throw new TypeError('net'); }).generate({}), { code: 'network' });
  await assert.rejects(mk(async () => ({ ok: true, json: async () => { throw new Error('x'); } })).generate({}), { code: 'bad_response' });
  await assert.rejects(vertexModel({ projectId: 'eternus-ask', getAccessToken: async () => { throw new Error('no creds'); }, fetch: async () => ({}) }).generate({}), { code: 'auth' });
  const slow = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('a'), { name: 'AbortError' }))));
  await assert.rejects(mk(slow, { timeoutMs: 20 }).generate({}), { code: 'timeout' });
});

// Fake clock: sleep advances time, so retry timing is deterministic and instant.
function retryModel(responses, { start = 1_000_000, random = () => 0.5 } = {}) {
  let t = start;
  const calls = [];
  const sleeps = [];
  const m = vertexModel({
    projectId: 'eternus-ask', getAccessToken: async () => 't', random,
    now: () => t,
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
    fetch: async (url, init) => {
      calls.push(init);
      const r = responses[Math.min(calls.length - 1, responses.length - 1)];
      return typeof r === 'number' ? { ok: false, status: r } : { ok: true, json: async () => r };
    },
  });
  return { m, calls, sleeps, at: () => t };
}
const OK = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"a":1}' }] } }] };

test('HTTP 429 and 503 get exactly one jittered retry within the request deadline', async () => {
  for (const status of [429, 503]) {
    const { m, calls, sleeps } = retryModel([status, OK]);
    const r = await m.generate({}, { deadlineAt: 1_000_000 + 17_000 });
    assert.equal(r.text, '{"a":1}');
    assert.equal(r.retries, 1);
    assert.equal(calls.length, 2);
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0] >= 1000 && sleeps[0] < 2000, `delay ${sleeps[0]}`);
  }
  const twice = retryModel([429, 429, OK]);
  await assert.rejects(twice.m.generate({}, { deadlineAt: 1_000_000 + 17_000 }), (e) => e.code === 'http_429' && e.retries === 1);
  assert.equal(twice.calls.length, 2, 'never a second retry');
});

test('other failures and a missing or exhausted deadline are never retried', async () => {
  for (const status of [400, 403, 404, 500]) {
    const { m, calls } = retryModel([status, OK]);
    await assert.rejects(m.generate({}, { deadlineAt: 1_000_000 + 17_000 }), (e) => e.code === `http_${status}` && e.retries === 0);
    assert.equal(calls.length, 1);
  }
  const noDeadline = retryModel([429, OK]);
  await assert.rejects(noDeadline.m.generate({}), (e) => e.code === 'http_429' && e.retries === 0);
  assert.equal(noDeadline.calls.length, 1, 'without a request deadline: single attempt, as before');
  const late = retryModel([429, OK]);
  await assert.rejects(late.m.generate({}, { deadlineAt: 1_000_000 + 4_000 }), { code: 'http_429' });
  assert.equal(late.calls.length, 1, 'not enough budget left for a useful second attempt');
});

test('each attempt is cut off at the request deadline, so the function timeout cannot be exceeded', async () => {
  let t = 0;
  const timeouts = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { timeouts.push(ms); return realSetTimeout(fn, 0); };
  try {
    const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('a'), { name: 'AbortError' }))));
    const m = vertexModel({ projectId: 'eternus-ask', getAccessToken: async () => 't', fetch: hang, now: () => t, sleep: async () => {} });
    await assert.rejects(m.generate({}, { deadlineAt: 5_000 }), (e) => e.code === 'timeout' && e.retries === 0);
    assert.ok(timeouts.includes(5_000) && !timeouts.includes(12_000), 'attempt timeout = min(12 s, time left)');
    t = 5_000;
    await assert.rejects(m.generate({}, { deadlineAt: 5_000 }), { code: 'timeout' });
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test('blocked prompts and missing candidates are reported, not treated as answers', () => {
  assert.equal(parseGenerateContent({ promptFeedback: { blockReason: 'SAFETY' } }).finishReason, 'BLOCKED');
  assert.equal(parseGenerateContent({}).finishReason, 'MISSING');
});
