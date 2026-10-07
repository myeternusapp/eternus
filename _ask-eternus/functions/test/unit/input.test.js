import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeText, parseInput, redact } from '../../src/input.js';

test('accepts a normal question and normalizes it', () => {
  const r = parseInput({ question: '  What   is​ Circle?\r\n ', locale: 'pt-PT', v: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.question, 'What is Circle?');
  assert.equal(r.locale, 'pt-PT');
  assert.equal(r.lengthBucket, '0-100');
});

test('rejects bad payloads without echoing them', () => {
  const cases = [
    [null, 'invalid_payload'], [[], 'invalid_payload'], [{}, 'missing_question'], [{ question: 5 }, 'missing_question'],
    [{ question: '   ' }, 'empty_question'], [{ question: 'a'.repeat(501) }, 'question_too_long'],
    [{ question: 'x\n'.repeat(25) }, 'too_many_lines'], [{ question: 'hi', locale: 'not a locale!' }, 'invalid_locale'],
    [{ question: 'hi', v: 2 }, 'unsupported_version'], [{ question: 'hi', pad: 'z'.repeat(3000) }, 'payload_too_large'],
  ];
  for (const [data, reason] of cases) {
    const r = parseInput(data);
    assert.equal(r.ok, false);
    assert.equal(r.reason, reason);
  }
});

test('500 characters is the maximum, counted by code points', () => {
  assert.equal(parseInput({ question: 'é'.repeat(500) }).ok, true);
  assert.equal(parseInput({ question: '\u{1F600}'.repeat(400) }).ok, true);
  assert.equal(parseInput({ question: 'a'.repeat(501) }).reason, 'question_too_long');
});

test('redacts emails and long numbers before the model sees them', () => {
  const r = parseInput({ question: 'My email is ana.silva@example.com, phone +351 912 345 678, code 123456. Year 2026?' });
  assert.equal(r.ok, true);
  assert.equal(r.question, 'My email is [email], phone [number], code [number]. Year 2026?');
  assert.equal(r.redacted, 3);
  assert.equal(redact('no personal data here').redacted, 0);
});

test('strips control and bidi characters', () => {
  assert.equal(normalizeText('a\u0000b‮c\u0007d'), 'abcd');
});
