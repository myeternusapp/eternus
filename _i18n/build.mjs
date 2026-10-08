#!/usr/bin/env node
// Eternus website localisation build. Zero dependencies (Node 18+).
//
//   node _i18n/build.mjs            generate /pt and /it pages, update English head/selector regions and sitemap.xml
//   node _i18n/build.mjs --check    verify that everything on disk is up to date (exit 1 if not); writes nothing
//   node _i18n/build.mjs extract    add new English strings to the locale files (as null) and report progress
//   node _i18n/build.mjs extract --prune   ...and remove strings that no longer exist in the English pages
//   node _i18n/build.mjs status     print translation progress per page and locale
//
// The English pages at the site root remain the hand-edited source of truth. See _i18n/README.md.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract, normalize, tagSignature } from './lib/extract.mjs';
import { splice } from './lib/html.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');
export const config = JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8'));

const SOURCE = config.defaultLocale;
export const targetLocales = Object.keys(config.locales).filter((l) => l !== SOURCE);
// Case-sensitive on purpose: "todo" is an ordinary Portuguese word.
const PLACEHOLDER = /\b(TODO|TBD|FIXME|XXX|[Ll]orem ipsum)\b|\[(?:translate|translation)\b/;
const VARS = /\{\w+\}/g;

// Work in LF internally; write each file back with the line endings its checkout already uses
// (Windows checkouts with core.autocrlf have CRLF), so git sees only real changes.
const lf = (s) => s.replace(/\r\n/g, '\n');
export const read = (rel) => lf(readFileSync(join(ROOT, rel), 'utf8'));
const usesCrlf = (rel) => existsSync(join(ROOT, rel)) && readFileSync(join(ROOT, rel), 'utf8').includes('\r\n');
const pageByFile = new Map(config.pages.map((p) => [p.file, p]));
/** Locale file name for a page: `id` from config, else the file name without .html. */
export const pageId = (file) => pageByFile.get(file)?.id ?? file.replace(/\.html$/, '');
/**
 * Secret pages (the Origin Archive) are translated but stay undiscoverable except through their
 * in-site entry point: no sitemap entry, no hreflang, no injected selector, and the English source
 * is never modified by the build.
 */
export const isSecret = (file) => pageByFile.get(file)?.secret === true;

export const isPublished = (locale, file) => locale === SOURCE || (config.publish[locale] ?? []).includes(file);
export const outputFile = (locale, file) => (locale === SOURCE ? file : `${config.locales[locale].dir}/${file}`);

export function pageUrl(locale, file) {
  const { dir } = config.locales[locale];
  const path = pageByFile.get(file).path;
  return config.origin + (dir ? `/${dir}` : '') + path;
}

/** Locales in which `file` exists, in config order. */
export const availableLocales = (file) => Object.keys(config.locales).filter((l) => isPublished(l, file));

// ---------------------------------------------------------------------------------------------
// Translations

export function loadTranslations(locale) {
  const dir = join(HERE, 'locales', locale);
  const files = {};
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      files[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    }
  }
  return files;
}

function lookup(files, file, key) {
  const page = files[pageId(file)] ?? {};
  const v = Object.hasOwn(page, key) ? page[key] : files._shared?.[key];
  return typeof v === 'string' && v.trim() ? v : null;
}

/** Problems with one translation, or [] if it is acceptable. */
export function validateTranslation(unit, value) {
  const problems = [];
  if (PLACEHOLDER.test(value)) problems.push('looks like placeholder text');
  if (unit.kind === 'text' && tagSignature(unit.key) !== tagSignature(value)) problems.push('markup differs from the English source');
  if ((unit.kind === 'attr' || unit.kind === 'script') && /<[a-z/]/i.test(value)) problems.push(`markup is not allowed in ${unit.kind === 'attr' ? 'an attribute' : 'a script string'}`);
  const vars = (s) => (s.match(VARS) ?? []).sort().join(',');
  if (vars(unit.key) !== vars(value)) problems.push('{placeholders} differ from the English source');
  if (value === unit.key && /\p{L}{4,}/u.test(value) && !config.sameAsSource.includes(value)) problems.push('identical to the English source');
  return problems;
}

function escapeAttr(value, quote) {
  if (quote === '"') return value.replace(/"/g, '&quot;');
  if (quote === "'") return value.replace(/'/g, '&#39;');
  return value;
}

// ---------------------------------------------------------------------------------------------
// Generated regions (head alternates + styles, language selectors)

function relativeHref(fromLocale, target) {
  const dir = config.locales[fromLocale].dir;
  if (!dir) return target;
  return target.startsWith(`${dir}/`) ? target.slice(dir.length + 1) : `../${target}`;
}

function selectorTarget(locale, file) {
  return isPublished(locale, file) ? outputFile(locale, file) : outputFile(locale, 'index.html');
}

function selectorLinks(locale, file, withCodes) {
  return Object.entries(config.locales).map(([l, info]) => {
    const current = l === locale ? ' aria-current="true"' : '';
    const text = withCodes ? `${info.label}<span class="lang-switch-sr"> ${info.name}</span>` : info.name;
    return `<li><a href="${relativeHref(locale, selectorTarget(l, file))}" hreflang="${info.hreflang}" lang="${info.lang}"${current}>${text}</a></li>`;
  });
}

let selectorCss = null;
function regions(locale, file) {
  selectorCss ??= readFileSync(join(HERE, 'selector.css'), 'utf8').trim().split('\n');
  const label = config.locales[locale].selectorLabel;
  const locales = availableLocales(file);
  const head = [
    '<!-- Generated by _i18n/build.mjs: alternates and language selector styles. Do not edit by hand. -->',
    ...(locales.length > 1
      ? [
          ...locales.map((l) => `<link rel="alternate" hreflang="${config.locales[l].hreflang}" href="${pageUrl(l, file)}" />`),
          `<link rel="alternate" hreflang="x-default" href="${pageUrl(SOURCE, file)}" />`,
          ...locales.filter((l) => l !== locale).map((l) => `<meta property="og:locale:alternate" content="${config.locales[l].ogLocale}" />`),
        ]
      : []),
    '<style>',
    ...selectorCss.map((l) => (l ? `  ${l}` : l)),
    '</style>',
  ];
  const header = [
    `<div class="lang-switch lang-switch--header" role="group" aria-label="${label}" translate="no">`,
    '  <ul class="lang-switch-list">',
    ...selectorLinks(locale, file, true).map((l) => `    ${l}`),
    '  </ul>',
    '</div>',
  ];
  const menu = [
    `<div class="lang-switch lang-switch--menu" role="group" aria-labelledby="lang-switch-heading" translate="no">`,
    `  <span class="lang-switch-heading" id="lang-switch-heading">${label}</span>`,
    '  <ul class="lang-switch-list">',
    ...selectorLinks(locale, file, false).map((l) => `    ${l}`),
    '  </ul>',
    '</div>',
  ];
  return { head, 'language-selector:header': header, 'language-selector:menu': menu };
}

function fillRegion(html, name, lines, file) {
  const re = new RegExp(`(<!-- i18n:${name} -->)[\\s\\S]*?(\\n([ \\t]*)<!-- /i18n:${name} -->)`, 'g');
  const matches = [...html.matchAll(re)];
  if (matches.length !== 1) throw new Error(`${file}: expected exactly one i18n:${name} region, found ${matches.length}`);
  const indent = matches[0][3];
  return html.replace(re, (_, open, close) => `${open}\n${lines.map((l) => (l ? indent + l : l)).join('\n')}${close}`);
}

function fillRegions(html, locale, file) {
  for (const [name, lines] of Object.entries(regions(locale, file))) html = fillRegion(html, name, lines, file);
  return html;
}

// ---------------------------------------------------------------------------------------------
// Localised page generation

function replaceOnce(html, re, fn, what, file) {
  const n = [...html.matchAll(new RegExp(re.source, 'g'))].length;
  if (n !== 1) throw new Error(`${file}: expected exactly one ${what}, found ${n}`);
  return html.replace(re, fn);
}

const pageByPath = new Map(config.pages.map((p) => [p.path, p.file]));

/** A site URL (https://origin/… or /…) for a page that exists in `locale` points at that version. */
function localizeSiteUrl(url, locale) {
  const absolute = url === config.origin || url.startsWith(`${config.origin}/`);
  if (!absolute && !/^\/(?!\/)/.test(url)) return url;
  const rest = absolute ? url.slice(config.origin.length) || '/' : url;
  const [, path, tail] = /^([^?#]*)(.*)$/.exec(rest);
  const file = pageByPath.get(path === '/index.html' ? '/' : path);
  if (!file || locale === SOURCE || !isPublished(locale, file)) return url;
  return (absolute ? config.origin : '') + `/${config.locales[locale].dir}${pageByFile.get(file).path}` + tail;
}

/**
 * URLs in a page generated at <dir>/<file>: relative URLs are re-resolved from the new location
 * (pages stay in the same language when translated, else fall back to English), and site URLs to
 * translated pages are localised. Script bodies and data: URIs are never touched, except the
 * relative `import('./…')` of a module.
 */
function rewriteUrls(html, locale, file) {
  const { dir } = config.locales[locale];
  const srcDir = posix.dirname(file);
  const outDir = posix.join(dir, srcDir);
  const fix = (url) => {
    if (!url || /^(?:#|\u0000|\u0001|\/\/)/.test(url)) return { url };
    if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(url)) return { url: localizeSiteUrl(url, locale) };
    const [, path, tail] = /^([^?#]*)(.*)$/.exec(url.replace(/^\.\//, ''));
    const resolved = posix.normalize(posix.join(srcDir, path));
    let target = resolved, fallback = false;
    if (pageByFile.has(resolved)) {
      if (isPublished(locale, resolved)) target = posix.join(dir, resolved);
      else fallback = true;
    }
    return { url: posix.relative(outDir, target) + tail, fallback };
  };
  const kept = [];
  const keep = (m) => `\u0000${kept.push(m) - 1}\u0000`;
  const scripts = [];
  const out = html
    // Script bodies may build markup in strings (e.g. src="' + img + '"): only their module imports move.
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_, open, body, close) =>
      `${open}\u0001${scripts.push(body.replace(/import\((['"])(\.\/[^'"]+)\1\)/g, (m, q, url) => `import(${q}${fix(url).url}${q})`)) - 1}\u0001${close}`)
    // data: URIs (e.g. the inline noise SVG) contain their own url(%23id) references: set them aside.
    .replace(/"data:[^"]*"|'data:[^']*'/g, keep)
    .replace(/(\s(?:href|src))=(["'])(.*?)\2/g, (_, a, q, url) => {
      const r = fix(url);
      return `${a}=${q}${r.url}${q}${r.fallback ? ` hreflang="${config.locales[SOURCE].hreflang}"` : ''}`;
    })
    .replace(/url\((['"]?)([^'")]+)\1\)/g, (_, q, url) => `url(${q}${fix(url).url}${q})`);
  return out
    .replace(/\u0000(\d+)\u0000/g, (_, i) => kept[i])
    .replace(/\u0001(\d+)\u0001/g, (_, i) => scripts[i]);
}

// ---------------------------------------------------------------------------------------------
// Strings inside <script> blocks. Only literals listed in a page's `scriptStrings` are translated,
// so code, identifiers and state keys can never be changed by a translation.

const JS_LITERAL = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const unescapeJs = (s) => s.replace(/\\(.)/g, '$1');
const escapeJs = (s, q) => s.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), `\\${q}`);
const scriptBodies = (html) => [...html.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/gi)]
  .map((m) => ({ start: m.index + m[1].length, end: m.index + m[1].length + m[2].length, body: m[2] }));

/** Units for the configured script strings found in `html` (each listed string must occur). */
export function scriptUnits(html, file) {
  const wanted = new Set(pageByFile.get(file)?.scriptStrings ?? []);
  const units = [];
  for (const { start, body } of scriptBodies(html)) {
    for (const m of body.matchAll(JS_LITERAL)) {
      const value = unescapeJs(m[2]);
      if (!wanted.has(value)) continue;
      units.push({ kind: 'script', key: value, start: start + m.index, end: start + m.index + m[0].length, quote: m[1] });
    }
  }
  const found = new Set(units.map((u) => u.key));
  const absent = [...wanted].filter((s) => !found.has(s));
  if (absent.length) throw new Error(`${file}: scriptStrings not found in its scripts: ${absent.join(' | ')}`);
  return units;
}

/**
 * Renders `file` in `locale` from the English source. Returns { html, missing, invalid }; html is
 * null when any string is missing or invalid.
 */
export function renderPage(locale, file, enSource, translations = loadTranslations(locale)) {
  const units = [...extract(enSource).units, ...scriptUnits(enSource, file)];
  const missing = [], invalid = [], edits = [];
  for (const u of units) {
    const value = lookup(translations, file, u.key);
    if (value === null) { missing.push(u.key); continue; }
    const problems = validateTranslation(u, value);
    if (problems.length) { invalid.push({ key: u.key, problems }); continue; }
    const text = u.kind === 'attr' ? escapeAttr(value, u.quote) : u.kind === 'script' ? u.quote + escapeJs(value, u.quote) + u.quote : value;
    edits.push({ start: u.start, end: u.end, text });
  }
  if (missing.length || invalid.length) return { html: null, missing: [...new Set(missing)], invalid };

  const { lang, ogLocale } = config.locales[locale];
  const url = pageUrl(locale, file);
  let html = rewriteUrls(splice(enSource, edits), locale, file);
  html = replaceOnce(html, /<html lang="[^"]*"/, () => `<html lang="${lang}"`, '<html lang>', file);
  if (isSecret(file)) return { html, missing, invalid };
  html = replaceOnce(html, /(<link rel="canonical" href=")[^"]*"/, (_, a) => `${a}${url}"`, 'canonical link', file);
  html = replaceOnce(html, /(<meta property="og:url" content=")[^"]*"/, (_, a) => `${a}${url}"`, 'og:url', file);
  html = replaceOnce(html, /(<meta name="twitter:url" content=")[^"]*"/, (_, a) => `${a}${url}"`, 'twitter:url', file);
  html = replaceOnce(html, /(<meta property="og:locale" content=")[^"]*"/, (_, a) => `${a}${ogLocale}"`, 'og:locale', file);
  return { html: fillRegions(html, locale, file), missing, invalid };
}

export function renderSitemap() {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ];
  for (const { file } of config.pages) {
    if (isSecret(file)) continue;
    const locales = availableLocales(file);
    for (const l of locales) {
      lines.push('  <url>', `    <loc>${pageUrl(l, file)}</loc>`);
      if (locales.length > 1) {
        for (const a of locales) lines.push(`    <xhtml:link rel="alternate" hreflang="${config.locales[a].hreflang}" href="${pageUrl(a, file)}" />`);
        lines.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${pageUrl(SOURCE, file)}" />`);
      }
      lines.push('  </url>');
    }
  }
  lines.push('</urlset>', '');
  return lines.join('\n');
}

/** Everything the build owns: { files: Map<relPath, content>, remove: [relPath], errors: [string] }. */
export function buildAll() {
  const files = new Map(), remove = [], errors = [];
  const sources = new Map();
  for (const { file } of config.pages) {
    // A secret page's English source is used as-is and never rewritten.
    const en = isSecret(file) ? read(file) : fillRegions(read(file), SOURCE, file);
    sources.set(file, en);
    if (!isSecret(file)) files.set(file, en);
  }
  for (const locale of targetLocales) {
    const translations = loadTranslations(locale);
    for (const name of config.publish[locale] ?? []) {
      if (!pageByFile.has(name)) errors.push(`${locale}: publish list names unknown page ${name}`);
    }
    for (const { file } of config.pages) {
      const out = outputFile(locale, file);
      if (!isPublished(locale, file)) {
        if (existsSync(join(ROOT, out))) remove.push(out);
        continue;
      }
      const r = renderPage(locale, file, sources.get(file), translations);
      if (!r.html) {
        errors.push(`${out}: not generated — ${r.missing.length} missing and ${r.invalid.length} invalid translation(s)`);
        for (const k of r.missing.slice(0, 5)) errors.push(`  missing: ${k.slice(0, 100)}`);
        for (const i of r.invalid.slice(0, 5)) errors.push(`  invalid (${i.problems.join('; ')}): ${i.key.slice(0, 100)}`);
        continue;
      }
      files.set(out, r.html);
    }
  }
  files.set('sitemap.xml', renderSitemap());
  return { files, remove, errors };
}

// ---------------------------------------------------------------------------------------------
// Translator workflow: extract + status

function sourceKeys() {
  const perPage = new Map();
  for (const { file } of config.pages) {
    const seen = new Set();
    const src = isSecret(file) ? read(file) : fillRegions(read(file), SOURCE, file);
    const units = [...extract(src).units, ...scriptUnits(src, file)];
    perPage.set(file, units.map((u) => u.key).filter((k) => !seen.has(k) && seen.add(k)));
  }
  return perPage;
}

function runExtract(prune) {
  const perPage = sourceKeys();
  const count = new Map();
  for (const keys of perPage.values()) for (const k of keys) count.set(k, (count.get(k) ?? 0) + 1);
  for (const locale of targetLocales) {
    const existing = loadTranslations(locale);
    const known = new Map();
    for (const [name, map] of Object.entries(existing)) {
      for (const [k, v] of Object.entries(map)) if (v !== null && (!known.has(k) || name === '_shared')) known.set(k, v);
    }
    const layout = { _shared: {} };
    for (const [file, keys] of perPage) {
      const name = pageId(file);
      layout[name] ??= {};
      for (const k of keys) (count.get(k) > 1 ? layout._shared : layout[name])[k] = known.get(k) ?? null;
    }
    const used = new Set(count.keys());
    const obsolete = [...known.keys()].filter((k) => !used.has(k));
    if (obsolete.length && !prune) {
      layout._obsolete = Object.fromEntries(obsolete.map((k) => [k, known.get(k)]));
    }
    const dir = join(HERE, 'locales', locale);
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) if (f.endsWith('.json')) rmSync(join(dir, f));
    for (const [name, map] of Object.entries(layout)) {
      writeFileSync(join(dir, `${name}.json`), JSON.stringify(map, null, 2) + '\n');
    }
    console.log(`${locale}: ${obsolete.length} obsolete string(s)${obsolete.length ? (prune ? ' removed' : ' kept in _obsolete.json') : ''}`);
  }
  runStatus();
}

function runStatus() {
  const perPage = sourceKeys();
  for (const locale of targetLocales) {
    const t = loadTranslations(locale);
    for (const [file, keys] of perPage) {
      const done = keys.filter((k) => lookup(t, file, k) !== null).length;
      const state = done === keys.length ? (isPublished(locale, file) ? 'published' : 'complete, not published') : (isPublished(locale, file) ? 'INCOMPLETE (build will fail)' : 'incomplete, not published');
      console.log(`${locale.padEnd(3)} ${file.padEnd(22)} ${String(done).padStart(4)}/${String(keys.length).padEnd(4)} ${state}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------

function main(argv) {
  if (argv[0] === 'extract') return runExtract(argv.includes('--prune'));
  if (argv[0] === 'status') return runStatus();
  const check = argv.includes('--check');
  const { files, remove, errors } = buildAll();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
    return;
  }
  const stale = [];
  for (const [rel, content] of files) {
    const abs = join(ROOT, rel);
    if (existsSync(abs) && read(rel) === content) continue;
    stale.push(rel);
    if (!check) {
      const crlf = existsSync(abs) ? usesCrlf(rel) : usesCrlf(config.pages[0].file);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, crlf ? content.replace(/\n/g, '\r\n') : content);
    }
  }
  for (const rel of remove) { stale.push(`${rel} (remove)`); if (!check) rmSync(join(ROOT, rel)); }
  if (check) {
    if (stale.length) { console.error(`Out of date — run node _i18n/build.mjs:\n  ${stale.join('\n  ')}`); process.exitCode = 1; }
    else console.log(`Up to date (${files.size} files).`);
  } else {
    console.log(stale.length ? `Updated:\n  ${stale.join('\n  ')}` : `Nothing to do (${files.size} files up to date).`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
