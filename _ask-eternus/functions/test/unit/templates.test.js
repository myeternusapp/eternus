import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseForbiddenTerms } from '../../src/terms.js';
import { contentViolation } from '../../src/output.js';
import { TEMPLATE_LANGUAGES, TEMPLATES, template, templateLanguage } from '../../src/templates.js';
import { ASK_ROOT, filters } from './helpers.js';

test('every template exists in all 7 languages and is short', () => {
  for (const [kind, langs] of Object.entries(TEMPLATES)) {
    assert.deepEqual(Object.keys(langs).sort(), [...TEMPLATE_LANGUAGES].sort(), kind);
    for (const t of Object.values(langs)) assert.ok(t.length > 20 && t.length <= 400, `${kind}: ${t.length}`);
  }
});

test('templates pass the answer filters and the KB forbidden terms (no death, prices, internals)', () => {
  const rules = parseForbiddenTerms(readFileSync(join(ASK_ROOT, 'checks', 'forbidden-terms.txt'), 'utf8'))
    .filter((r) => r.allowed === null || r.allowed.length === 0);
  for (const [kind, langs] of Object.entries(TEMPLATES)) {
    for (const [lang, t] of Object.entries(langs)) {
      assert.equal(contentViolation(t, filters), null, `${kind}/${lang}`);
      for (const r of rules) assert.ok(!r.rx.test(t), `${kind}/${lang} contains "${r.term}"`);
    }
  }
});

test('language selection falls back to English', () => {
  assert.equal(templateLanguage('pt-BR'), 'pt');
  assert.equal(templateLanguage('el'), 'el');
  assert.equal(templateLanguage('ja'), 'en');
  assert.equal(templateLanguage(undefined), 'en');
  assert.equal(template('unknown', 'zz').language, 'en');
});
