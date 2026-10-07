#!/usr/bin/env node
// Staging gates that must pass before any production enablement:
//   1. a fresh limited-use App Check token is accepted;
//   2. replaying the SAME token is rejected (401) — replay protection. If this fails: STOP.
//   3. a request without a token is rejected (401);
//   4. a request with another Origin is rejected;
//   5. a request with a forged X-Forwarded-For (TEST-NET-3 address) is sent so the function log's
//      xffEntries / xffFirstTestNet fields show which entry Google appends (sets RATE_LIMIT_IP_SOURCE).
//
//   ASK_ETERNUS_DEBUG_TOKEN=... node eval/staging-gates.mjs --endpoint <URL> --project <id> --app-id <id> --api-key <key>
import { parseArgs } from 'node:util';
import { callAsk, limitedUseToken, requireEnv } from './lib.mjs';

const { values: opt } = parseArgs({
  options: { endpoint: { type: 'string' }, project: { type: 'string' }, 'app-id': { type: 'string' }, 'api-key': { type: 'string' } },
});
for (const k of ['endpoint', 'project', 'app-id', 'api-key']) if (!opt[k]) throw new Error(`--${k} is required`);
const debugToken = requireEnv('ASK_ETERNUS_DEBUG_TOKEN');
const fresh = () => limitedUseToken({ projectNumberOrId: opt.project, appId: opt['app-id'], apiKey: opt['api-key'], debugToken });
const data = { question: 'What is Circle?', locale: 'en', v: 1 };

const results = [];
const gate = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };

const token = await fresh();
const first = await callAsk({ endpoint: opt.endpoint, token, data });
gate('fresh limited-use token accepted', first.status === 200, `HTTP ${first.status} kind=${first.data?.kind ?? first.data?.status}`);
const replay = await callAsk({ endpoint: opt.endpoint, token, data });
gate('replayed token rejected', replay.status === 401, `HTTP ${replay.status}`);
const none = await callAsk({ endpoint: opt.endpoint, token: null, data });
gate('missing token rejected', none.status === 401, `HTTP ${none.status}`);
const evil = await callAsk({ endpoint: opt.endpoint, token: await fresh(), data, origin: 'https://evil.example' });
gate('foreign origin rejected', evil.status === 403, `HTTP ${evil.status}`);
const forged = await callAsk({ endpoint: opt.endpoint, token: await fresh(), data, extraHeaders: { 'x-forwarded-for': '203.0.113.7' } });
gate('forged X-Forwarded-For request sent (read xffEntries/xffFirstTestNet in the log)', forged.status === 200, `HTTP ${forged.status}`);

const replayFailed = !results[1].pass;
if (replayFailed) console.log('\nSTOP: replay protection did not reject a reused token. Do not fall back to reusable tokens; report it.');
process.exit(results.every((r) => r.pass) ? 0 : 1);
