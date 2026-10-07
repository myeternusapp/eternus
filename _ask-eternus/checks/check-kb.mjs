#!/usr/bin/env node
// Validates the Ask Eternus Knowledge Base (_ask-eternus/). Read-only.
// Usage: node checks/check-kb.mjs [path/to/_ask-eternus]   — exit code 1 on any failure.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseForbiddenTerms } from '../functions/src/terms.js';

export { parseForbiddenTerms, termRegex } from '../functions/src/terms.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = resolve(HERE, '..');

const CLASSES = new Set(['current', 'planned', 'unknown', 'off_topic', 'account_specific', 'injection', 'clarify', 'assistant_policy']);
const ID_RE = /^[a-z]+(\.[a-z0-9-]+)+$/;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export function checkKb(root = DEFAULT_ROOT) {
  const fails = [];
  const notes = [];
  const fail = (m) => fails.push(m);
  const p = (...a) => join(root, ...a);

  for (const f of ['manifest.json', 'kb', 'eval/questions.jsonl', 'checks/forbidden-terms.txt']) {
    if (!existsSync(p(f))) fail(`missing ${f}`);
  }
  if (fails.length) return { fails, notes, rules: [] };

  // encoding of the KB content (kb/, manifest, eval, terms)
  const files = ['manifest.json', 'eval/questions.jsonl', 'checks/forbidden-terms.txt', ...readdirSync(p('kb')).map((f) => `kb/${f}`)];
  for (const f of files) {
    const b = readFileSync(p(f));
    if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) fail(`${f}: BOM`);
    if (b.includes(0x0d)) fail(`${f}: CR characters (expected LF line endings)`);
    try { new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { fail(`${f}: not UTF-8`); }
  }

  const man = JSON.parse(readFileSync(p('manifest.json'), 'utf8'));
  const ids = man.sections.map((s) => s.id);
  if (new Set(ids).size !== ids.length) fail('duplicate section ids');
  const kbFiles = readdirSync(p('kb')).filter((f) => statSync(p('kb', f)).isFile()).sort();
  const expectedFiles = ids.map((i) => `${i}.md`).sort();
  if (JSON.stringify(kbFiles) !== JSON.stringify(expectedFiles)) fail('manifest sections != kb/ files');
  const statusValues = man.answer_policy?.status_values ?? [];
  const titles = new Set(man.sections.map((s) => s.title));
  const words = {};

  for (const s of man.sections) {
    const file = p(s.file);
    if (!existsSync(file)) { fail(`${s.id}: missing file`); continue; }
    const data = readFileSync(file);
    if (sha256(data) !== s.sha256) fail(`${s.id}: sha256 mismatch`);
    if (!ID_RE.test(s.id)) fail(`${s.id}: bad id`);
    if (!statusValues.includes(s.status)) fail(`${s.id}: bad status`);
    if (!s.sources?.length) fail(`${s.id}: no sources`);
    for (const r of s.related) if (!ids.includes(r)) fail(`${s.id}: related ${r} unknown`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.last_reviewed)) fail(`${s.id}: last_reviewed`);
    const text = data.toString('utf8');
    const m = /^---\n([\s\S]*?)\n---\n\n# ([^\n]+)\n\n/.exec(text);
    if (!m) { fail(`${s.id}: front matter/title layout`); continue; }
    const fm = Object.fromEntries(m[1].split('\n').map((l) => { const i = l.indexOf(': '); return [l.slice(0, i), l.slice(i + 2)]; }));
    const want = {
      id: s.id, title: `"${s.title}"`, status: s.status, last_reviewed: s.last_reviewed,
      applies_to: `[${s.applies_to.join(', ')}]`, related: `[${s.related.join(', ')}]`,
    };
    if (JSON.stringify(fm) !== JSON.stringify(want)) fail(`${s.id}: front matter != manifest`);
    if (m[2] !== s.title) fail(`${s.id}: H1 != title`);
    if (s.status === 'planned' && !text.includes('This is planned and not available yet.')) fail(`${s.id}: planned wording`);
    words[s.id] = text.slice(m[0].length).split(/\s+/).filter(Boolean).length;
    for (const ref of text.matchAll(/\(see \*([^*]+)\*\)|(?<![*\w])\*([^*\n]+\?)\*(?!\*)/g)) {
      const t = ref[1] ?? ref[2];
      if (!titles.has(t)) fail(`${s.id}: cross-reference to unknown title "${t}"`);
    }
  }
  const counts = Object.values(words);
  notes.push(`sections: ${ids.length}; words min/max ${Math.min(...counts)}/${Math.max(...counts)}`);

  // forbidden terms
  const rules = parseForbiddenTerms(readFileSync(p('checks', 'forbidden-terms.txt'), 'utf8'));
  for (const f of kbFiles) {
    const sid = f.slice(0, -3);
    const text = readFileSync(p('kb', f), 'utf8');
    for (const r of rules) {
      const hit = r.rx.exec(text);
      if (hit && !(r.allowed && r.allowed.includes(sid))) fail(`kb/${f}: forbidden "${r.term}" -> "${hit[0]}"`);
    }
  }
  const mtext = readFileSync(p('manifest.json'), 'utf8').replace(/"sha256": "[0-9a-f]{64}"/g, '"sha256": ""');
  for (const r of rules) if (r.scope === 'kb+manifest' && r.rx.test(mtext)) fail(`manifest.json: forbidden "${r.term}"`);
  notes.push(`forbidden-term rules: ${rules.length} (${rules.filter((r) => r.scope === 'kb+manifest').length} also on manifest)`);

  // evaluation set
  const qs = readFileSync(p('eval', 'questions.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  if (qs.length !== man.eval.count) fail('eval count != manifest');
  const qids = qs.map((q) => q.id);
  if (new Set(qids).size !== qids.length) fail('duplicate question ids');
  const req = ['id', 'category', 'lang', 'question', 'expected', 'must_cite', 'must_mention', 'must_not_claim'];
  for (const q of qs) {
    const missing = req.filter((k) => !(k in q));
    if (missing.length) fail(`${q.id}: missing fields ${missing}`);
    if (!CLASSES.has(q.expected)) fail(`${q.id}: bad expected`);
    for (const c of q.must_cite) if (!ids.includes(c)) fail(`${q.id}: cites unknown ${c}`);
    if (q.expected === 'current' && !q.must_cite.length) fail(`${q.id}: current without citation`);
    if (q.expected === 'current' && !q.must_mention.length) fail(`${q.id}: current without must_mention`);
    if (['off_topic', 'injection', 'account_specific', 'unknown'].includes(q.expected) && !q.must_not_claim.length) fail(`${q.id}: ${q.expected} without must_not_claim`);
    for (const e of q.question.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) if (!e[0].endsWith('@example.com')) fail(`${q.id}: real-looking email ${e[0]}`);
  }
  const groups = {};
  for (const q of qs) if (q.intent_group) (groups[q.intent_group] ??= []).push(q);
  for (const [g, list] of Object.entries(groups)) {
    if (list.length < 3) fail(`intent_group ${g} has ${list.length} questions`);
    if (new Set(list.map((q) => q.expected)).size !== 1) fail(`intent_group ${g}: mixed expected`);
  }
  const cited = new Set(qs.flatMap((q) => q.must_cite));
  const uncited = ids.filter((i) => !cited.has(i));
  if (uncited.length) notes.push(`KB sections never cited by an eval question: ${uncited.join(', ')}`);
  notes.push(`questions: ${qs.length}`);
  return { fails, notes, rules, manifest: man, questions: qs };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { fails, notes } = checkKb(process.argv[2] ? resolve(process.argv[2]) : DEFAULT_ROOT);
  for (const n of notes) console.log('  ' + n);
  if (fails.length) {
    console.log(`FAIL (${fails.length}):`);
    for (const f of fails) console.log('  - ' + f);
    process.exit(1);
  }
  console.log('PASS');
}
