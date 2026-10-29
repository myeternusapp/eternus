#!/usr/bin/env node
// Runs the 180-question evaluation set against the STAGING deployment (approved test window only).
//
//   ASK_ETERNUS_DEBUG_TOKEN=... node eval/run-eval.mjs --endpoint <callable URL> \
//     --project <project id> --app-id <Firebase app id> --api-key <web API key> [--runs 3] [--judge]
//
// Every question gets its own limited-use App Check token (replay protection stays on).
// --judge additionally asks gemini-3.5-flash-lite (Vertex AI, EU endpoint, local ADC credentials)
// to check must_mention / must_not_claim; every judged failure still needs human review.
// Results go to eval/results/ (git-ignored).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { callAsk, gates, groupConsistency, limitedUseToken, requireEnv, scoreAnswer } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const { values: opt } = parseArgs({
  options: {
    endpoint: { type: 'string' }, project: { type: 'string' }, 'app-id': { type: 'string' },
    'api-key': { type: 'string' }, runs: { type: 'string', default: '3' }, judge: { type: 'boolean', default: false },
    only: { type: 'string' }, 'delay-ms': { type: 'string', default: '1500' },
  },
});
for (const k of ['endpoint', 'project', 'app-id', 'api-key']) if (!opt[k]) throw new Error(`--${k} is required`);
const debugToken = requireEnv('ASK_ETERNUS_DEBUG_TOKEN');

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const kbIds = manifest.sections.map((s) => s.id);
let questions = readFileSync(join(ROOT, 'eval', 'questions.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
if (opt.only) questions = questions.filter((q) => opt.only.split(',').includes(q.id));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const runs = [];
for (let run = 1; run <= Number(opt.runs); run++) {
  const scored = [];
  for (const q of questions) {
    const token = await limitedUseToken({ projectNumberOrId: opt.project, appId: opt['app-id'], apiKey: opt['api-key'], debugToken });
    const { status, data } = await callAsk({ endpoint: opt.endpoint, token, data: { question: q.question, locale: q.lang, v: 1 } });
    const s = scoreAnswer(q, data, kbIds);
    s.httpStatus = status;
    s.answer = data?.answer ?? null;
    if (opt.judge && s.answer) s.judge = await judge(q, s.answer);
    scored.push(s);
    process.stdout.write(s.pass ? '.' : 'x');
    await sleep(Number(opt['delay-ms']));
  }
  process.stdout.write('\n');
  runs.push({ run, gates: gates(scored), groups: groupConsistency(questions, scored), scored });
  console.log(`run ${run}:`, JSON.stringify(runs.at(-1).gates));
}

mkdirSync(join(ROOT, 'eval', 'results'), { recursive: true });
const out = join(ROOT, 'eval', 'results', `eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ kbVersion: manifest.kb_version, model: 'gemini-3.5-flash-lite', runs }, null, 1));
console.log('results:', out);

async function judge(q, answer) {
  const require = createRequire(join(ROOT, 'functions', 'package.json'));
  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const url = `https://aiplatform.eu.rep.googleapis.com/v1/projects/${opt.project}/locations/eu/publishers/google/models/gemini-3.5-flash-lite:generateContent`;
  const prompt = `You are grading a support answer. Do not answer the question yourself.
Question: ${JSON.stringify(q.question)}
Answer: ${JSON.stringify(answer)}
The answer MUST convey each of these points (meaning, any language): ${JSON.stringify(q.must_mention)}
The answer MUST NOT claim any of these: ${JSON.stringify(q.must_not_claim)}
Return JSON: {"missing": [points not conveyed], "violations": [forbidden claims made]}.`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await auth.getAccessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 400 },
    }),
  });
  if (!r.ok) return { error: `http_${r.status}` };
  const j = await r.json();
  try { return JSON.parse(j.candidates[0].content.parts.map((p) => p.text).join('')); } catch { return { error: 'parse' }; }
}
