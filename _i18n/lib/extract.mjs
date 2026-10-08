// Finds the translatable units of an English page, gettext-style: each unit is keyed by its English
// source (whitespace collapsed), so a change to the English text automatically invalidates the old
// translation instead of silently keeping it.
//
// Units are:
//  - text segments: a run of text plus inline markup (<em>, <br>, <a>, <strong>, <span>...) inside a
//    block. Inline markup stays in the string so translators can move it, but tags must be kept.
//  - attributes: alt, title, aria-label, placeholder, data-i18n-* and the content of selected <meta>.
// Anything inside an element with translate="no" (or <script>/<style>) is left alone.

import { attr, parse } from './html.mjs';

const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd',
  'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr']);
const SKIP = new Set(['script', 'style']);
const TEXT_ATTRS = new Set(['alt', 'title', 'aria-label', 'placeholder']);
const META_KEYS = new Set(['title', 'description', 'keywords', 'og:title', 'og:description', 'twitter:title', 'twitter:description']);
// Attributes that may legitimately differ between a source segment and its translation.
export const LOCALISABLE_ATTRS = new Set([...TEXT_ATTRS, 'hreflang', 'lang']);

const LETTER = /\p{L}/u;
const EMAIL_ONLY = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/;

export const normalize = (s) => s.replace(/\s+/g, ' ').trim();

function isTranslatableText(html) {
  const text = normalize(html.replace(/<[^>]*>/g, ' '));
  return LETTER.test(text) && !EMAIL_ONLY.test(text);
}

function noTranslate(el) {
  return attr(el, 'translate')?.value === 'no';
}

function isInlineTree(el) {
  return INLINE.has(el.tag) && !noTranslate(el) && el.children.every((c) => c.type !== 'element' || isInlineTree(c));
}

function translatableAttrs(el) {
  const out = [];
  for (const a of el.attrs) {
    if (a.value === null) continue;
    let ok = TEXT_ATTRS.has(a.name) || a.name.startsWith('data-i18n-');
    if (a.name === 'content' && el.tag === 'meta') {
      ok = META_KEYS.has(attr(el, 'name')?.value ?? attr(el, 'property')?.value ?? '');
    }
    if (ok && isTranslatableText(a.value)) out.push(a);
  }
  return out;
}

/**
 * Returns { units: [{ kind: 'text' | 'attr', key, start, end, source, quote?, tag, name? }] } in
 * document order. `start`/`end` delimit exactly the characters a translation replaces.
 */
export function extract(src, tree = parse(src)) {
  const units = [];

  function addSegment(nodes) {
    const first = nodes[0], last = nodes[nodes.length - 1];
    let start = first.start, end = last.end;
    while (start < end && /\s/.test(src[start])) start++;
    while (end > start && /\s/.test(src[end - 1])) end--;
    const source = src.slice(start, end);
    if (!isTranslatableText(source)) return;
    units.push({ kind: 'text', key: normalize(source), source, start, end, tag: first.parent.tag });
  }

  function visit(node) {
    if (node.type !== 'element' && node.type !== 'root') return;
    if (node.type === 'element') {
      if (SKIP.has(node.tag) || noTranslate(node)) return;
      for (const a of translatableAttrs(node)) {
        units.push({ kind: 'attr', key: normalize(a.value), source: a.value, start: a.valueStart, end: a.valueEnd, quote: a.quote, tag: node.tag, name: a.name });
      }
    }
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const hasText = run.some((n) => n.type === 'text' && LETTER.test(src.slice(n.start, n.end)));
      if (hasText) addSegment(run.filter((n, i, all) => n.type !== 'comment' || (i > 0 && i < all.length - 1)));
      else for (const n of run) visit(n);
      run = [];
    };
    for (const child of node.children) {
      if (child.type === 'text' || child.type === 'comment' || (child.type === 'element' && isInlineTree(child))) {
        run.push(child);
      } else {
        flush();
        visit(child);
      }
    }
    flush();
  }

  visit(tree);
  units.sort((a, b) => a.start - b.start);
  return { tree, units };
}

/** Opening tags in an HTML fragment, minus attributes that are expected to be localised. */
export function tagSignature(html) {
  const tags = [];
  for (const m of html.matchAll(/<\/?([a-zA-Z][\w:-]*)([^>]*)>/g)) {
    const attrs = [...m[2].matchAll(/([^\s"'=\/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)]
      .filter((a) => !LOCALISABLE_ATTRS.has(a[1].toLowerCase()))
      .map((a) => `${a[1].toLowerCase()}=${(a[2] ?? '').replace(/^["']|["']$/g, '')}`)
      .sort();
    tags.push(`${m[0][1] === '/' ? '/' : ''}${m[1].toLowerCase()}[${attrs.join(' ')}]`);
  }
  return tags.sort().join(' ');
}
