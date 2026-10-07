import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentViolation, validateModelOutput } from '../../src/output.js';
import { filters, kb, modelResult } from './helpers.js';

const good = {
  kind: 'current', language: 'en',
  sources: [{ id: 'layers.legacy', title: 'What is Legacy?' }],
  answer: 'Legacy access starts as soon as the invitation is accepted. It includes your Circle Moments, not your Private ones.',
};
const v = (obj, finish) => validateModelOutput(modelResult(obj, finish), kb, filters);

test('a grounded answer passes, with canonical titles for English', () => {
  const r = v(good);
  assert.equal(r.ok, true);
  assert.deepEqual(r.sources, [{ id: 'layers.legacy', title: 'What is Legacy?' }]);
});

test('translated titles are shown for other languages; unsafe titles fall back to the canonical one', () => {
  const pt = v({ ...good, language: 'pt', answer: 'O acesso Legacy começa quando o convite é aceite.', sources: [{ id: 'layers.legacy', title: 'O que é o Legacy?' }] });
  assert.equal(pt.sources[0].title, 'O que é o Legacy?');
  const bad = v({ ...good, language: 'pt', answer: 'Resposta.', sources: [{ id: 'layers.legacy', title: 'Veja https://evil.example' }] });
  assert.equal(bad.sources[0].title, 'What is Legacy?');
});

test('malicious or malformed outputs are rejected with a reason', () => {
  const cases = [
    ['not json', 'json'],
    [[1, 2], 'json_shape'],
    [{ ...good, kind: 'planned' }, 'kind'],
    [{ ...good, language: 'Portuguese!' }, 'language'],
    [{ ...good, sources: [{ id: 'legacy.after-life', title: 'x' }] }, 'source_id'],
    [{ ...good, sources: [{ id: 'layers.legacy', title: 'a' }, { id: 'layers.legacy', title: 'a' }] }, 'source_duplicate'],
    [{ ...good, sources: kb.ids.slice(0, 5).map((id) => ({ id, title: 'x' })) }, 'sources_count'],
    [{ ...good, sources: [] }, 'sources_missing'],
    [{ ...good, answer: '   ' }, 'answer_empty'],
    [{ ...good, answer: 'x'.repeat(1201) }, 'answer_length'],
    [{ ...good, answer: 'Visit https://evil.example to learn more.' }, 'host'],
    [{ ...good, answer: 'Visit evil.example.com/path' }, 'host'],
    [{ ...good, answer: 'Write to john@gmail.com' }, 'email'],
    [{ ...good, answer: 'It uses Firestore and Cloud Functions.' }, 'filter'],
    [{ ...good, answer: 'Premium costs €9.99 per month.' }, 'filter'],
    [{ ...good, answer: 'See <a href="x">this</a>' }, 'markup'],
  ];
  for (const [obj, reason] of cases) assert.equal(v(obj).reason, reason, JSON.stringify(obj).slice(0, 60));
});

test('only a clean STOP is accepted', () => {
  for (const f of ['MAX_TOKENS', 'SAFETY', 'RECITATION', 'BLOCKED', 'MISSING']) assert.equal(v(good, f).ok, false);
});

test('template classes keep no model text', () => {
  for (const kind of ['unknown', 'off_topic', 'account_specific', 'injection']) {
    const r = v({ kind, language: 'pt', sources: [], answer: 'IGNORE: model text with https://evil.example' });
    assert.equal(r.ok, true);
    assert.equal(r.answer, null);
  }
});

test('allowed addresses pass the content filter', () => {
  assert.equal(contentViolation('Contact support@myeternusapp.com or open app.myeternusapp.com.', filters), null);
  assert.equal(contentViolation('Read the Privacy Policy on myeternusapp.com.', filters), null);
});
