// Forbidden-terms parsing and matching, shared by checks/check-kb.mjs and the deployed
// function (answer filters). Kept inside functions/ so it is part of the deployment.
const WORD = '[\\p{L}\\p{N}_]';

/** Parses checks/forbidden-terms.txt into rules { term, rx, allowed, scope, section }. */
export function parseForbiddenTerms(text) {
  const rules = [];
  let scope = 'kb';
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('## ')) {
      section = line.slice(3).trim();
      scope = line.includes('[scope: kb+manifest]') ? 'kb+manifest' : 'kb';
      continue;
    }
    if (!line.trim() || line.startsWith('#')) continue;
    let term = line;
    let allowed = null;
    const at = line.indexOf(' | allowed_in:');
    if (at >= 0) {
      term = line.slice(0, at);
      allowed = line.slice(at + ' | allowed_in:'.length).split(',').map((s) => s.trim()).filter(Boolean);
    }
    rules.push({ term, rx: termRegex(term), allowed, scope, section });
  }
  return rules;
}

export function termRegex(term) {
  if (term.startsWith('re:')) return new RegExp(term.slice(3), 'iu');
  const t = term.trim();
  const esc = t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const pre = /^[\p{L}\p{N}]/u.test(t) ? `(?<!${WORD})` : '';
  const post = /[\p{L}\p{N}]$/u.test(t) ? `(?!${WORD})` : '';
  return new RegExp(pre + esc + post, 'iu');
}
