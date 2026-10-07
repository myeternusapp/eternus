#!/usr/bin/env node
// Packages the approved Knowledge Base for the server: validates _ask-eternus/ with
// checks/check-kb.mjs, then writes functions/generated/kb.json (git-ignored, deployed with the
// function). Fails — and so aborts `firebase deploy` via predeploy — on any validation error.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkKb } from '../../checks/check-kb.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT = resolve(HERE, '..', 'generated', 'kb.json');

// Sections of checks/forbidden-terms.txt that are language-independent and therefore also
// applied to model answers in any language (see src/output.js).
const ANSWER_FILTER_SECTIONS = [/^Secrets, identifiers/, /^Internal technical details/];
const ANSWER_FILTER_REGEX_FROM = /^Plans and pricing/;

export function contentHash(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function buildKb(root = ROOT) {
  const { fails, rules, manifest } = checkKb(root);
  if (fails.length) throw new Error(`KB validation failed:\n  - ${fails.join('\n  - ')}`);

  const sections = manifest.sections.map((s) => {
    const text = readFileSync(join(root, s.file), 'utf8');
    const body = text.replace(/^---\n[\s\S]*?\n---\n\n# [^\n]+\n\n/, '').trim();
    return { id: s.id, title: s.title, applies_to: s.applies_to, body };
  });
  const answerFilters = rules
    .filter((r) => ANSWER_FILTER_SECTIONS.some((rx) => rx.test(r.section))
      || (ANSWER_FILTER_REGEX_FROM.test(r.section) && r.term.startsWith('re:')))
    .map((r) => r.term);

  const payload = {
    kbVersion: manifest.kb_version,
    lastReviewed: manifest.last_reviewed,
    sections,
    assistantPolicy: manifest.assistant_policy.rules,
    answerFilters,
  };
  return { ...payload, contentHash: contentHash(payload) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const kb = buildKb();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(kb, null, 1) + '\n');
  console.log(`kb.json: KB ${kb.kbVersion}, ${kb.sections.length} sections, ${kb.answerFilters.length} answer filters, hash ${kb.contentHash.slice(0, 12)}`);
}
