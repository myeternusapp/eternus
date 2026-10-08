// Run with: node --test _i18n/test/i18n.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize as normPath } from 'node:path';
import { test } from 'node:test';
import {
  ROOT, availableLocales, buildAll, config, isPublished, loadTranslations, outputFile, pageUrl, read,
  renderSitemap, targetLocales, validateTranslation,
} from '../build.mjs';
import { extract, normalize, tagSignature } from '../lib/extract.mjs';
import { attr, parse, splice, walk } from '../lib/html.mjs';

const locales = Object.keys(config.locales);
const pages = config.pages.map((p) => p.file);
const published = locales.flatMap((l) => pages.filter((f) => isPublished(l, f)).map((f) => ({ locale: l, file: f, out: outputFile(l, f) })));
const html = (rel) => read(rel);
const elements = (src) => [...walk(parse(src))].filter((n) => n.type === 'element');
const get = (el, name) => attr(el, name)?.value ?? null;

test('html parser: every source and generated page parses strictly', () => {
  for (const { out } of published) assert.doesNotThrow(() => parse(html(out)), out);
});

test('html parser: rejects mismatched tags instead of guessing', () => {
  assert.throws(() => parse('<div><p>text</div>'), /Unexpected <\/div>/);
  assert.throws(() => parse('<div>'), /Unclosed <div>/);
});

test('extract: segments keep inline markup, skip scripts, styles, translate="no" and emails', () => {
  const src = '<html><head><title>T&amp;C</title><meta name="description" content="Desc"><meta name="author" content="Eternus"></head>'
    + '<body><p>Hello <em>world</em>.<br>Bye</p><ul><li><svg><path d="M0"/></svg> Item one</li></ul>'
    + '<button aria-label="Open menu"><span>01</span><span class="n">Name</span></button>'
    + '<div translate="no"><a href="#">English</a></div><script>var s = "Hidden";</script>'
    + '<a href="mailto:a@b.com">a@b.com</a><img alt="Photo" src="x.png"></body></html>';
  const keys = extract(src).units.map((u) => u.key);
  assert.deepEqual(keys, ['T&amp;C', 'Desc', 'Hello <em>world</em>.<br>Bye', 'Item one', 'Open menu', 'Name', 'Photo']);
});

test('extract: replacing every unit with its own source reproduces each page byte-for-byte', () => {
  for (const file of pages) {
    const src = html(file);
    const { units } = extract(src);
    assert.equal(splice(src, units.map((u) => ({ start: u.start, end: u.end, text: src.slice(u.start, u.end) }))), src, file);
    for (const u of units) assert.equal(u.key, normalize(src.slice(u.start, u.end)), `${file}: ${u.key}`);
  }
});

test('tagSignature: ignores localisable attributes, catches changed markup', () => {
  assert.equal(tagSignature('<a href="x.html" aria-label="One">a</a>'), tagSignature('<a aria-label="Um" href="x.html">b</a>'));
  assert.notEqual(tagSignature('<a href="x.html">a</a>'), tagSignature('<a href="y.html">a</a>'));
  assert.notEqual(tagSignature('a <em>b</em>'), tagSignature('a b'));
});

test('build: everything on disk is up to date and nothing is missing', () => {
  const { files, remove, errors } = buildAll();
  assert.deepEqual(errors, []);
  assert.deepEqual(remove, []);
  for (const [rel, content] of files) assert.equal(read(rel), content, `${rel} is stale — run node _i18n/build.mjs`);
});

test('translations: every stored translation is valid, including unpublished drafts', () => {
  for (const locale of targetLocales) {
    for (const file of pages) {
      const t = loadTranslations(locale);
      for (const u of extract(html(file)).units) {
        const name = file.replace(/\.html$/, '');
        const value = t[name]?.[u.key] ?? t._shared?.[u.key];
        if (typeof value !== 'string') continue;
        assert.deepEqual(validateTranslation(u, value), [], `${locale}/${file}: ${u.key}`);
      }
    }
  }
});

test('translations: published pages contain no untranslated English strings', () => {
  for (const { locale, file, out } of published.filter((p) => p.locale !== config.defaultLocale)) {
    const english = new Set(extract(html(file)).units.map((u) => u.key));
    for (const u of extract(html(out)).units) {
      if (english.has(u.key) && /\p{L}{4,}/u.test(u.key)) {
        assert.ok(config.sameAsSource.includes(u.key), `${out} still has English text: ${u.key}`);
      }
    }
    assert.ok(!/\b(TODO|TBD|FIXME)\b|lorem ipsum/.test(html(out)), `${out} contains placeholder text`);
  }
});

test('unpublished translations are not generated and not linked', () => {
  for (const locale of targetLocales) {
    for (const file of pages.filter((f) => !isPublished(locale, f))) {
      assert.ok(!existsSync(join(ROOT, outputFile(locale, file))), `${outputFile(locale, file)} must not exist`);
      assert.ok(!renderSitemap().includes(pageUrl(locale, file)), `sitemap lists unpublished ${locale}/${file}`);
    }
  }
});

test('metadata: lang, canonical, social URLs and og:locale match the page', () => {
  for (const { locale, file, out } of published) {
    const els = elements(html(out));
    const url = pageUrl(locale, file);
    const meta = (k) => els.find((e) => e.tag === 'meta' && (get(e, 'property') === k || get(e, 'name') === k));
    assert.equal(get(els.find((e) => e.tag === 'html'), 'lang'), config.locales[locale].lang, out);
    assert.equal(get(els.find((e) => e.tag === 'link' && get(e, 'rel') === 'canonical'), 'href'), url, out);
    assert.equal(get(meta('og:url'), 'content'), url, out);
    assert.equal(get(meta('twitter:url'), 'content'), url, out);
    assert.equal(get(meta('og:locale'), 'content'), config.locales[locale].ogLocale, out);
  }
});

test('social previews: every page shares one existing branded image with matching size and Twitter/X card', () => {
  const images = new Set();
  for (const { out } of published) {
    const els = elements(html(out));
    const meta = (k) => get(els.find((e) => e.tag === 'meta' && (get(e, 'property') === k || get(e, 'name') === k)), 'content');
    const og = meta('og:image');
    assert.ok(og?.startsWith(`${config.origin}/`), `${out}: og:image must be an absolute site URL`);
    assert.equal(meta('twitter:image'), og, `${out}: twitter:image differs from og:image`);
    assert.equal(meta('twitter:card'), 'summary_large_image', out);
    const file = join(ROOT, og.slice(config.origin.length + 1));
    assert.ok(existsSync(file), `${out}: ${og} does not exist`);
    const png = readFileSync(file);
    assert.equal(png.toString('latin1', 1, 4), 'PNG', `${out}: expected a PNG preview image`);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [Number(meta('og:image:width')), Number(meta('og:image:height'))], `${out}: declared size`);
    images.add(og);
  }
  assert.equal(images.size, 1, `pages use different preview images: ${[...images].join(', ')}`);
});

test('hreflang: alternates are reciprocal, self-referencing, complete and include x-default', () => {
  for (const file of pages) {
    const cluster = availableLocales(file);
    // A page that exists in one language only carries no alternates at all.
    const expected = cluster.length > 1
      ? [...cluster.map((l) => `${config.locales[l].hreflang} ${pageUrl(l, file)}`), `x-default ${pageUrl(config.defaultLocale, file)}`]
      : [];
    for (const l of cluster) {
      const out = outputFile(l, file);
      const got = elements(html(out)).filter((e) => e.tag === 'link' && get(e, 'rel') === 'alternate')
        .map((e) => `${get(e, 'hreflang')} ${get(e, 'href')}`);
      assert.deepEqual([...got].sort(), [...expected].sort(), out);
    }
  }
});

test('language selector: present twice per page, one current language, correct lang/hreflang, links resolve', () => {
  for (const { locale, out } of published) {
    const els = elements(html(out));
    const groups = els.filter((e) => (get(e, 'class') ?? '').split(/\s+/).includes('lang-switch'));
    assert.equal(groups.length, 2, `${out}: header + menu selectors`);
    for (const g of groups) {
      assert.equal(get(g, 'translate'), 'no');
      assert.ok(get(g, 'aria-label') || get(g, 'aria-labelledby'), `${out}: selector needs an accessible name`);
      const links = [...walk(g)].filter((n) => n.tag === 'a');
      assert.equal(links.length, locales.length);
      assert.deepEqual(links.filter((a) => get(a, 'aria-current') === 'true').map((a) => get(a, 'hreflang')), [config.locales[locale].hreflang]);
      for (const [i, a] of links.entries()) {
        const info = config.locales[locales[i]];
        assert.equal(get(a, 'hreflang'), info.hreflang);
        assert.equal(get(a, 'lang'), info.lang);
        assert.ok(existsSync(join(ROOT, dirname(out), get(a, 'href'))), `${out}: ${get(a, 'href')}`);
      }
    }
  }
});

test('links: every relative href, src, url() and import() resolves to a file', () => {
  for (const { out } of published) {
    const src = html(out);
    const urls = [
      ...[...src.matchAll(/\s(?:href|src)=(["'])(.*?)\1/g)].map((m) => m[2]),
      ...[...src.matchAll(/url\((['"]?)([^'")]+)\1\)/g)].map((m) => m[2]),
      ...[...src.matchAll(/import\((['"])(.*?)\1\)/g)].map((m) => m[2]),
    ];
    for (const u of urls) {
      if (!u || /^(?:[a-z][a-z0-9+.-]*:|#|%23|\/)/i.test(u)) continue;
      const path = u.split(/[?#]/)[0];
      assert.ok(existsSync(normPath(join(ROOT, dirname(out), path))), `${out}: broken relative URL ${u}`);
    }
  }
});

test('scripts: localised pages run exactly the same JavaScript as English (only asset paths change)', () => {
  const scripts = (src) => elements(src).filter((e) => e.tag === 'script').map((e) => src.slice(e.openEnd, e.closeStart));
  for (const { locale, file, out } of published.filter((p) => p.locale !== config.defaultLocale)) {
    const en = scripts(html(file)).map((s) => s.replace(/(['"])\.\/assets\//g, '$1../assets/'));
    assert.deepEqual(scripts(html(out)), en, `${locale}/${file}`);
  }
});

test('styles: localised pages use exactly the same CSS as English (only asset paths change)', () => {
  const styles = (src) => elements(src).filter((e) => e.tag === 'style').map((e) => src.slice(e.openEnd, e.closeStart));
  for (const { locale, file, out } of published.filter((p) => p.locale !== config.defaultLocale)) {
    const en = styles(html(file)).map((s) => s.replace(/url\((['"]?)assets\//g, 'url($1../assets/'));
    assert.deepEqual(styles(html(out)), en, `${locale}/${file}`);
  }
  for (const { out } of published) assert.ok(!html(out).includes('../%23'), `${out}: a data URI was rewritten`);
});

test('scripts: every label the JavaScript reads from markup exists on the page', () => {
  for (const { out } of published) {
    const src = html(out);
    const els = elements(src);
    const burger = els.find((e) => get(e, 'id') === 'nav-hamburger');
    assert.ok(get(burger, 'aria-label') && get(burger, 'data-i18n-close-label'), `${out}: hamburger labels`);
    const form = els.find((e) => get(e, 'id') === 'ask-form');
    for (const m of src.matchAll(/\btext\('([\w-]+)'/g)) {
      assert.ok(get(form, `data-i18n-${m[1]}`), `${out}: missing data-i18n-${m[1]} on #ask-form`);
    }
  }
});

// The browser client imports the Firebase SDK from a CDN; load it without those imports (no network).
async function loadAskClient() {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { pathToFileURL } = await import('node:url');
  const src = read('assets/js/ask-eternus.js').replace(/^import .* from 'https:[^']+';$/gm, '');
  const file = join(mkdtempSync(join(tmpdir(), 'ask-client-')), 'ask-eternus.mjs');
  writeFileSync(file, src);
  return import(pathToFileURL(file).href);
}

test('Ask Eternus: the page language decides the service-message language, via the existing locale field', async () => {
  const { requestLocale } = await loadAskClient();
  const { templateLanguage } = await import('../../_ask-eternus/functions/src/templates.js');
  const { parseInput } = await import('../../_ask-eternus/functions/src/input.js');
  const expected = { en: 'en', pt: 'pt', it: 'it' };
  for (const { locale, out } of published.filter((p) => p.file === 'support.html')) {
    const pageLang = get(elements(html(out)).find((e) => e.tag === 'html'), 'lang');
    for (const browser of ['en-US', 'pt-BR', 'it-IT', 'de-DE', 'zh-Hans-CN', undefined]) {
      const sent = requestLocale(pageLang, browser);
      assert.equal(sent, pageLang, `${out}: page language must win over browser ${browser}`);
      assert.equal(templateLanguage(sent), expected[locale], `${out}: server template language`);
      assert.equal(parseInput({ question: 'What is Circle?', locale: sent, v: 1 }).ok, true, `${out}: server accepts ${sent}`);
    }
  }
  // fallbacks: no usable page language -> browser language; unsupported or missing -> English on the server
  assert.equal(requestLocale('', 'pt-PT'), 'pt-PT');
  assert.equal(requestLocale('not a tag!', 'it'), 'it');
  assert.equal(requestLocale(undefined, 'x'.repeat(20)), null);
  assert.equal(templateLanguage(requestLocale('ja', 'ja-JP')), 'en');
  assert.equal(templateLanguage(requestLocale(undefined, undefined)), 'en');
});

test('sitemap: lists exactly the published pages with matching alternates', () => {
  const xml = read('sitemap.xml');
  const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]).sort();
  assert.deepEqual(locs, published.map(({ locale, file }) => pageUrl(locale, file)).sort());
  assert.match(xml, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  assert.equal(xml.charCodeAt(0), '<'.charCodeAt(0), 'no BOM');
});
