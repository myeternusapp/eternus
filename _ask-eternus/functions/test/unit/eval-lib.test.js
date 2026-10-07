import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { gates, groupConsistency, scoreAnswer } from '../../../eval/lib.mjs';
import { ASK_ROOT, kb } from './helpers.js';

const qs = readFileSync(join(ASK_ROOT, 'eval', 'questions.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byId = (id) => qs.find((q) => q.id === id);

test('eval set: 159 questions, all expected classes answerable by the service', () => {
  assert.equal(qs.length, 159);
  const kinds = new Set(['current', 'clarify', 'unknown', 'off_topic', 'account_specific', 'injection', 'assistant_policy']);
  assert.ok(qs.every((q) => kinds.has(q.expected)), 'no expected class the service cannot return');
});

test('scoring: kind, citations, language', () => {
  const q = qs.find((x) => x.expected === 'current' && x.lang === 'en');
  const ok = scoreAnswer(q, { kind: 'current', language: 'en', answer: 'a', sources: [{ id: q.must_cite[0], title: 't' }] }, kb.ids);
  assert.equal(ok.pass, true);
  const wrongKind = scoreAnswer(q, { kind: 'unknown', language: 'en', answer: 'a', sources: [] }, kb.ids);
  assert.equal(wrongKind.checks.kind, false);
  const badCite = scoreAnswer(q, { kind: 'current', language: 'en', answer: 'a', sources: [{ id: 'nope', title: 't' }] }, kb.ids);
  assert.equal(badCite.checks.validSources, false);
  const pt = qs.find((x) => x.lang === 'pt');
  assert.equal(scoreAnswer(pt, { kind: pt.expected, language: 'en', answer: 'a', sources: [] }, kb.ids).checks.language, false);
});

test('release gates: strict classes must be 100%, overall kind >= 95%', () => {
  const strict = qs.filter((q) => ['injection', 'account_specific', 'off_topic'].includes(q.expected));
  const scored = strict.map((q) => scoreAnswer(q, { kind: q.expected, language: q.lang, answer: 'a', sources: [] }, kb.ids));
  assert.equal(gates(scored).strictPass, true);
  scored[0].checks.kind = false;
  assert.equal(gates(scored).strictPass, false);
  const groups = groupConsistency(qs, qs.filter((q) => q.intent_group).map((q) => scoreAnswer(q, { kind: q.expected, language: q.lang, answer: 'a', sources: q.must_cite.map((id) => ({ id })) }, kb.ids)));
  assert.ok(groups.length >= 6 && groups.every((g) => g.sameKind));
  assert.ok(byId('Q001'));
});
