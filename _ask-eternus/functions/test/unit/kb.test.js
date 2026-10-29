import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkKb } from '../../../checks/check-kb.mjs';
import { buildKb } from '../../scripts/build-kb.mjs';
import { loadKb, verifyKb } from '../../src/kb.js';
import { ASK_ROOT, kb } from './helpers.js';

test('the committed KB v1 validates and packages', () => {
  const r = checkKb(ASK_ROOT);
  assert.deepEqual(r.fails, []);
  const built = buildKb(ASK_ROOT);
  assert.equal(built.kbVersion, '1.3.0');
  assert.equal(built.sections.length, 43);
  assert.ok(verifyKb(built));
  assert.equal(built.contentHash, kb.contentHash, 'generated/kb.json is up to date');
  assert.ok(!JSON.stringify(built).includes('must_not_claim'), 'eval set is never packaged');
  assert.ok(built.sections.every((s) => !s.body.startsWith('---')), 'front matter stripped');
});

test('Messenger sections state that Messenger may not be available yet', () => {
  const messenger = kb.sections.filter((s) => s.id.startsWith('messenger.'));
  assert.equal(messenger.length, 4);
  for (const s of messenger) {
    assert.ok(s.body.startsWith('**Messenger is being prepared for the Beta of the Eternus Android app. It may not be available in your version of the app yet.**'), s.id);
  }
});

test('a tampered or missing packaged KB is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-'));
  try {
    const j = JSON.parse(readFileSync(join(ASK_ROOT, 'functions', 'generated', 'kb.json'), 'utf8'));
    j.sections[0].body += ' Legacy unlocks after death.';
    writeFileSync(join(dir, 'kb.json'), JSON.stringify(j));
    assert.equal(loadKb(join(dir, 'kb.json')), null);
    assert.equal(loadKb(join(dir, 'missing.json')), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('negative control: the validator catches forbidden terms, bad citations and edited sections', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kbneg-'));
  try {
    for (const p of ['manifest.json', 'kb', 'eval', 'checks']) cpSync(join(ASK_ROOT, p), join(dir, p), { recursive: true });
    appendFileSync(join(dir, 'kb', 'layers.legacy.md'), '\nLegacy unlocks after death. Data is in Firestore. Premium costs €9.\n');
    appendFileSync(join(dir, 'eval', 'questions.jsonl'), JSON.stringify({
      id: 'Q999', category: 'core', lang: 'en', question: 'x', expected: 'current', must_cite: ['nope.section'], must_mention: ['x'], must_not_claim: [],
    }) + '\n');
    const { fails } = checkKb(dir);
    for (const want of ['sha256 mismatch', '"death"', '"firestore"', '"premium"', '€9', 'eval count', 'cites unknown nope.section']) {
      assert.ok(fails.some((f) => f.includes(want)), `expected a failure mentioning ${want}`);
    }
    assert.throws(() => buildKb(dir), /KB validation failed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
