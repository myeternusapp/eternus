# Website localisation (EN / PT / IT)

The English pages at the site root stay the hand-edited source of truth. A zero-dependency Node
script generates the Portuguese (`/pt/`) and Italian (`/it/`) pages from them. Generated pages are
committed, so GitHub Pages serves plain static files and needs no build step. This folder starts with
`_`, so GitHub Pages (Jekyll) does not publish it.

```
node _i18n/build.mjs              # regenerate /pt, /it, English head + selector regions, sitemap.xml
node _i18n/build.mjs --check      # exit 1 if anything on disk is out of date (writes nothing)
node _i18n/build.mjs status       # translation progress per page and language
node _i18n/build.mjs extract      # add new English strings to the locale files as null
node --test _i18n/test/i18n.test.mjs
```

Requires Node 18 or later.

## How it works

- `lib/html.mjs` parses each English page strictly, keeping source offsets. Anything it does not
  translate stays byte-for-byte identical, including CSS, JavaScript, SVG and attributes.
- `lib/extract.mjs` finds the translatable units:
  - text with its inline markup (`<em>`, `<br>`, `<a>`, `<strong>`, `<span>`);
  - `alt`, `title`, `aria-label` and `placeholder` attributes;
  - `data-i18n-*` attributes (strings that JavaScript reads, such as the hamburger and Ask Eternus
    messages);
  - the title, description and social `<meta>` tags.

  Anything inside `translate="no"`, `<script>` or `<style>` is skipped.
- Locale files are keyed by the English text, as with gettext: `locales/<lang>/<page>.json`, plus
  `_shared.json` for strings that appear on more than one page. If the English text changes, its
  old translation no longer matches, so the page is reported as incomplete. A stale translation is
  never published.
- The build also:
  - fills the `<!-- i18n:… -->` regions in every page: hreflang alternates, the selector styles
    (`selector.css`), and the header and mobile-menu language selectors;
  - sets `lang`, the canonical URL, `og:url`, `twitter:url` and `og:locale`;
  - prefixes asset paths with `../` in generated pages;
  - points links to pages that are not translated at the English page, marked `hreflang="en"`;
  - writes `sitemap.xml` with `xhtml:link` alternates.

## Publishing rules (`config.json`)

A page is published in a language only when **both** of these are true:

1. It is listed in `publish.<lang>`.
2. Every string has a valid translation.

If a listed page is incomplete or invalid, the build fails and nothing is half-published. A
translation is invalid if:

- its markup differs from the English;
- `{placeholders}` are missing;
- it contains placeholder text (TODO and similar);
- it is identical to the English and is not listed in `sameAsSource`.

The Privacy Policy is deliberately **not** listed. Its Portuguese and Italian translations are
drafts held outside this repository, pending legal review. Do not commit
`locales/*/privacy-policy.json` until that review is complete. To publish the policy after review:

1. Add the reviewed `locales/pt/privacy-policy.json` and/or `locales/it/privacy-policy.json`.
2. Add `"privacy-policy.html"` to `publish.pt` and/or `publish.it`.
3. Run the build and the tests.

## Common tasks

- **Edit English copy:** edit the root `.html` file, then run `node _i18n/build.mjs extract`. Fill
  the new `null` entries in `locales/pt` and `locales/it`, then run `node _i18n/build.mjs` and the
  tests.
- **Add a page:** add it to `pages` in `config.json` and add the three `<!-- i18n:… -->` markers
  (copy them from an existing page). Then run `extract`, translate, list the page under `publish`,
  and build.
- **Add a language:** add an entry to `locales` in `config.json`, then run `extract`, translate,
  set `publish`, and build.

## Translation conventions

- Product names stay in English, matching the app and Ask Eternus: Moments/Moment, Private, Circle,
  Legacy, My Tree, My Digital Tree, Talk to Eternus, Ask Eternus.
- Portuguese is European Portuguese (pt-PT) in the formal register ("o seu", "Partilhe"), and
  Eternus is feminine ("a Eternus").
- Italian uses the informal "tu", and "Eternus" takes no article.
- Keep every tag and attribute from the English string. You may move tags within the sentence.
