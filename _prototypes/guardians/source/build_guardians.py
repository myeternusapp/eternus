# Run from anywhere: python _prototypes/guardians/source/build_guardians.py
# Builds the OFFLINE Guardians prototype: _prototypes/guardians/{,pt/,it/}guardians.html
# Header/menu/footer markup and their approved CSS are copied from each language's faq.html (read-only).
# noindex; not linked from any page; not in the sitemap; the folder starts with "_" (never published by GitHub Pages).
import os, re, sys, posixpath, html as H
sys.path.insert(0, os.path.dirname(__file__))
from guardians_text import T
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))  # repository root
OUT = '_prototypes/guardians'
LANGS = {'en': '', 'pt': 'pt/', 'it': 'it/'}

def block(s, a, b):
    i = s.index(a); j = s.index(b, i) + len(b); return s[i:j]

def relocate(html, orig_dir, new_dir):
    def fix(m):
        attr, q, url = m.group(1), m.group(2), m.group(3)
        if re.match(r'^(https?:|mailto:|tel:|data:|javascript:|#|/|\{|@@)', url): return m.group(0)
        path, frag = (url.split('#', 1) + [''])[:2]
        target = posixpath.normpath(posixpath.join(orig_dir, path)) if path else None
        new = posixpath.relpath(target, new_dir) if target else ''
        return f'{attr}={q}{new}{"#" + frag if frag else ""}{q}'
    return re.sub(r'\b(href|src)=(["\'])([^"\']*)\2', fix, html)

faq_en = open(os.path.join(REPO, 'faq.html'), encoding='utf-8').read()
I18N_CSS = re.search(r'<!-- i18n:head -->.*?(<style>.*?</style>)', faq_en, re.S).group(1)
HEADER_CSS = block(faq_en, '    /* ===== Light FAQ (approved): header and navigation of the homepage', '    /* the header now sits in the page flow')
HEADER_CSS = HEADER_CSS[:HEADER_CSS.rindex('    /* the header now sits in the page flow')]
FOOTER_CSS = faq_en[faq_en.index('    /* ---------- Footer (approved design, shared by every page)'):faq_en.index('    /* ===== Light FAQ (approved): header and navigation')]

PAGE_CSS = r'''
    :root { --black: #06060a; --gold: #c9a84c; --gold-light: #e8c97a; --white: #f5f0ea; --muted: #6c6672; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }
    body { background: #fff; color: var(--ink-2); font-family: var(--sans); font-size: 1rem; line-height: 1.65; -webkit-font-smoothing: antialiased; overflow-x: hidden; }
    img { max-width: 100%; display: block; } a { color: inherit; } ul, ol { list-style: none; }
    :focus-visible { outline: 2px solid var(--gold-ink); outline-offset: 3px; border-radius: 4px; }
    .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    .wrap { max-width: 1120px; margin: 0 auto; padding: 0 60px; }
    .label { display: inline-flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 0.72rem; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase; color: var(--gold-ink); margin-bottom: 18px; }
    .dev { font-size: 0.62rem; letter-spacing: 0.14em; color: var(--ink-3); border: 1px solid var(--line-strong); border-radius: 999px; padding: 3px 10px; }
    h1, h2, h3 { font-family: var(--serif); color: var(--ink); font-weight: 500; letter-spacing: -0.012em; }
    h1 em, h2 em { font-style: italic; font-weight: 400; color: var(--gold-ink); }
    h2 { font-size: clamp(2rem, 3.4vw, 2.9rem); line-height: 1.08; margin-bottom: 20px; max-width: 18em; }
    h3 { font-size: 1.45rem; line-height: 1.2; margin-bottom: 10px; }
    .lead { font-size: clamp(1.02rem, 1.2vw, 1.1rem); line-height: 1.75; color: var(--ink-2); max-width: 40em; }
    .note { margin-top: 28px; max-width: 44em; font-family: var(--serif); font-style: italic; font-size: 1.22rem; line-height: 1.5; color: var(--gold-ink); }
    section.g { padding: 96px 0; border-top: 1px solid var(--line); }
    section.g.warm { background: var(--paper-warm); }

    /* Prototype ribbon */
    .proto { background: #fff7e0; color: #5c4510; font-size: 0.78rem; text-align: center; padding: 6px 16px; border-bottom: 1px solid #ecd9a3; }

    /* Opening: dark, with three equal points around the story (the three Guardians) */
    .g-hero { background: var(--ink); color: #fff; padding: 104px 0 100px; overflow: hidden; }
    .g-hero .wrap { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 56px; align-items: center; }
    .g-hero .label { color: var(--gold-light); }
    .g-hero h1 { color: #fff; font-size: clamp(2.6rem, 5vw, 4.3rem); line-height: 1.04; margin-bottom: 24px; }
    .g-hero h1 em { color: var(--gold-light); }
    .g-hero .intro { font-size: clamp(1.04rem, 1.25vw, 1.14rem); line-height: 1.75; color: rgba(255,255,255,0.84); max-width: 32em; }
    .g-hero .principle { margin-top: 22px; font-family: var(--serif); font-style: italic; font-size: 1.4rem; line-height: 1.4; color: var(--gold-light); max-width: 26em; }
    .g-status { display: flex; gap: 12px; align-items: flex-start; margin-top: 34px; padding-top: 22px; border-top: 1px solid rgba(255,255,255,0.14); max-width: 36em; font-size: 0.92rem; line-height: 1.6; color: rgba(255,255,255,0.78); }
    .g-status .pill { flex: none; font-size: 0.62rem; font-weight: 500; letter-spacing: 0.16em; text-transform: uppercase; color: var(--gold-light); border: 1px solid rgba(232,201,122,0.55); border-radius: 999px; padding: 4px 11px; margin-top: 1px; }
    .trio { width: 100%; max-width: 360px; justify-self: center; overflow: visible; }
    .trio line { stroke: rgba(232,201,122,0.45); stroke-width: 1; }
    .trio .node { fill: var(--ink); stroke: var(--gold-light); stroke-width: 1.5; }
    .trio .core { fill: var(--gold-light); }
    .trio .halo { fill: none; stroke: rgba(232,201,122,0.18); stroke-width: 1; }
    .js .trio line { stroke-dasharray: 160; stroke-dashoffset: 160; animation: draw 1.6s cubic-bezier(0.65,0,0.25,1) 0.3s forwards; }
    @keyframes draw { to { stroke-dashoffset: 0; } }

    /* Is / is not */
    .isnot { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 36px; }
    .isnot > div { border: 1px solid var(--line); border-radius: 18px; padding: 30px 30px 26px; }
    .isnot .yes { background: var(--paper-warm); }
    .isnot h3 { font-size: 1.3rem; margin-bottom: 16px; }
    .tick li, .cross li { position: relative; padding-left: 30px; margin-bottom: 12px; line-height: 1.65; }
    .tick li::before { content: ''; position: absolute; left: 2px; top: 0.5em; width: 12px; height: 7px; border-left: 1.6px solid var(--gold-ink); border-bottom: 1.6px solid var(--gold-ink); transform: rotate(-45deg); }
    .cross li::before, .cross li::after { content: ''; position: absolute; left: 3px; top: 0.78em; width: 13px; height: 1.6px; background: var(--ink-3); transform: rotate(45deg); }
    .cross li::after { transform: rotate(-45deg); }

    /* Three equal cards */
    .three { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; margin-top: 36px; }
    .three > div { border-top: 1px solid var(--gold); padding-top: 22px; }
    .three .dot { display: block; width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid var(--gold); background: #fff; margin-bottom: 16px; box-shadow: 0 0 0 5px rgba(201,168,76,0.12); }
    .three p { color: var(--ink-2); }

    /* Steps */
    .steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 24px; margin-top: 36px; counter-reset: s; }
    .steps li { position: relative; padding-top: 52px; color: var(--ink-2); line-height: 1.6; counter-increment: s; }
    .steps li::before { content: counter(s); position: absolute; left: 0; top: 0; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--gold); color: var(--gold-ink); font-weight: 500; font-size: 0.9rem; display: flex; align-items: center; justify-content: center; background: #fff; }
    .steps li::after { content: ''; position: absolute; left: 44px; right: -14px; top: 17px; height: 1px; background: var(--line-strong); }
    .steps li:last-child::after { display: none; }

    /* While alive */
    .alive-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 56px; align-items: start; }
    .panel { background: #fff; border: 1px solid var(--line); border-radius: 18px; padding: 30px 30px 26px; }
    .panel h3 { font-size: 1.25rem; margin-bottom: 16px; }
    .panel .small { margin-top: 16px; font-size: 0.95rem; color: var(--ink-3); }

    /* Death reported: the timeline */
    .tl { position: relative; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 24px; margin-top: 44px; }
    .tl::before { content: ''; position: absolute; left: 7px; right: 7px; top: 7px; height: 1px; background: linear-gradient(to right, var(--gold), rgba(201,168,76,0.4)); }
    .tl li { position: relative; padding-top: 36px; }
    .tl li::before { content: ''; position: absolute; left: 0; top: 0; width: 15px; height: 15px; border-radius: 50%; background: #fff; border: 1.5px solid var(--gold); }
    .tl li:first-child::before, .tl li:last-child::before { background: var(--gold); }
    .tl .when { display: block; font-size: 0.72rem; font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase; color: var(--gold-ink); margin-bottom: 8px; }
    .tl h3 { font-size: 1.3rem; }
    .tl p { color: var(--ink-2); line-height: 1.65; }
    .protect { margin-top: 48px; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 24px; padding: 32px 34px; border: 1px solid var(--gold); border-radius: 18px; background: var(--paper-warm); }
    .protect .shield { width: 46px; height: 46px; border-radius: 50%; border: 1px solid var(--gold); display: flex; align-items: center; justify-content: center; color: var(--gold-ink); background: #fff; }
    .protect h3 { font-size: 1.4rem; }
    .protect p { color: var(--ink-2); }
    .protect p + p { margin-top: 12px; }
    .protect strong { color: var(--ink); font-weight: 600; }

    /* Preserved */
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 36px; }

    /* Tree */
    .tree-grid { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: 56px; align-items: start; }
    .branch { width: 100%; max-width: 300px; margin-top: 28px; overflow: visible; }
    .branch path, .branch line { fill: none; stroke: var(--line-strong); stroke-width: 1.5; }
    .branch .new { stroke: var(--gold); stroke-dasharray: 4 5; }
    .branch circle { fill: #fff; stroke: var(--ink-3); stroke-width: 1.5; }
    .branch .pres { stroke: var(--gold); fill: var(--paper-warm); }
    .branch .kid { stroke: var(--gold); fill: #fff; stroke-dasharray: 3 3; }
    .vsteps { counter-reset: v; }
    .vsteps li { position: relative; padding: 0 0 22px 50px; counter-increment: v; color: var(--ink-2); line-height: 1.65; }
    .vsteps li::before { content: counter(v); position: absolute; left: 0; top: -2px; width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--gold); color: var(--gold-ink); font-weight: 500; font-size: 0.86rem; display: flex; align-items: center; justify-content: center; background: #fff; }
    .vsteps li::after { content: ''; position: absolute; left: 16px; top: 34px; bottom: 2px; width: 1px; background: var(--line-strong); }
    .vsteps li:last-child::after { display: none; }
    .vsteps li:last-child { color: var(--ink); font-weight: 500; }
    .callout { margin-top: 8px; padding: 18px 22px; border-left: 2px solid var(--gold); background: var(--paper-warm); border-radius: 0 12px 12px 0; color: var(--ink-2); }

    /* Visibility */
    .vis { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr); gap: 56px; align-items: center; }
    .msg { border: 1px solid var(--line); border-radius: 18px; padding: 26px; display: grid; gap: 14px; }
    .msg .row { display: flex; align-items: center; gap: 12px; color: var(--ink-2); font-size: 0.95rem; }
    .msg .av { width: 34px; height: 34px; border-radius: 50%; border: 1.5px solid var(--gold); background: var(--paper-warm); flex: none; }
    .msg .bubble { margin-left: 46px; padding: 10px 14px; border-radius: 14px 14px 14px 4px; background: var(--paper-warm); border: 1px solid var(--line); width: 72%; height: 16px; }

    /* When things change */
    .cards3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; margin-top: 36px; }
    .cards3 > div { background: #fff; border: 1px solid var(--line); border-radius: 18px; padding: 28px 26px 22px; }
    .cards3 li { position: relative; padding-left: 18px; margin-bottom: 12px; color: var(--ink-2); line-height: 1.6; font-size: 0.97rem; }
    .cards3 li::before { content: '—'; position: absolute; left: 0; color: var(--gold-ink); }
    .cards3 li:last-child { color: var(--ink); }

    /* Support */
    .support-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: 56px; align-items: start; }
    .dash li { position: relative; padding-left: 22px; margin-bottom: 10px; color: var(--ink-2); line-height: 1.6; }
    .dash li::before { content: '—'; position: absolute; left: 0; color: var(--gold-ink); }
    .mail { display: inline-block; margin-top: 18px; color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--gold); padding-bottom: 2px; font-weight: 500; }
    .mail:hover { color: var(--gold-ink); }

    /* FAQ */
    .qa { margin-top: 36px; border-top: 1px solid var(--line); max-width: 860px; }
    .qa-item { border-bottom: 1px solid var(--line); }
    .qa-btn { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 20px 0; background: none; border: 0; font-family: var(--serif); font-size: 1.28rem; font-weight: 500; color: var(--ink); text-align: left; cursor: pointer; }
    .qa-cue { flex: none; width: 30px; height: 30px; border-radius: 50%; border: 1.5px solid var(--gold); position: relative; background: rgba(201,168,76,0.08); transition: background 0.3s, transform 0.4s; }
    .qa-cue::before, .qa-cue::after { content: ''; position: absolute; left: 50%; top: 50%; width: 10px; height: 1.5px; background: var(--gold-ink); transform: translate(-50%, -50%); transition: opacity 0.3s, background 0.3s; }
    .qa-cue::after { transform: translate(-50%, -50%) rotate(90deg); }
    .qa-item.open .qa-cue { background: var(--ink); border-color: var(--ink); transform: rotate(180deg); }
    .qa-item.open .qa-cue::before { background: #fff; }
    .qa-item.open .qa-cue::after { opacity: 0; }
    .qa-a { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.4s cubic-bezier(0.22,1,0.36,1); }
    .qa-item.open .qa-a { grid-template-rows: 1fr; }
    .qa-a > div { overflow: hidden; }
    .qa-a p { padding: 0 48px 22px 0; color: var(--ink-2); line-height: 1.75; }
    .qa-item:not(.open) .qa-a > div { visibility: hidden; transition: visibility 0s linear 0.4s; }

    /* Closing */
    .g-close { padding: 8px 60px 104px; }
    .g-close .inner { max-width: 1000px; margin: 0 auto; background: var(--ink); border-radius: 20px; padding: 76px 64px; text-align: center; }
    .g-close h2 { color: #fff; margin: 0 auto 18px; max-width: 20em; font-size: clamp(2rem, 3.6vw, 3rem); }
    .g-close h2 em { color: var(--gold-light); }
    .g-close p { color: rgba(255,255,255,0.82); font-size: 1.08rem; max-width: 34em; margin: 0 auto; line-height: 1.7; }

    @media (prefers-reduced-motion: reduce) { .js .trio line { animation: none; stroke-dashoffset: 0; } .qa-a, .qa-cue { transition: none; } }
    @media (max-width: 960px) {
      .g-hero .wrap { grid-template-columns: 1fr; gap: 40px; }
      .trio { max-width: 260px; justify-self: start; }
      .steps, .tl { grid-template-columns: 1fr 1fr; row-gap: 36px; }
      .steps li:nth-child(2)::after, .tl::before { display: none; }
      .tl li::after { content: ''; position: absolute; left: 22px; right: 0; top: 7px; height: 1px; background: rgba(201,168,76,0.4); }
      .alive-grid, .tree-grid, .vis, .support-grid { grid-template-columns: 1fr; gap: 32px; }
      .cards3, .three { grid-template-columns: 1fr; }
    }
    @media (max-width: 640px) {
      .wrap { padding: 0 24px; }
      .g-hero { padding: 56px 0 56px; }
      .g-hero .principle { font-size: 1.22rem; }
      section.g { padding: 64px 0; }
      .isnot, .two { grid-template-columns: 1fr; gap: 16px; }
      .isnot > div, .panel { padding: 24px 22px 20px; }
      .steps, .tl { grid-template-columns: 1fr; row-gap: 26px; }
      .steps li::after, .tl li::after { display: none; }
      .tl::before { display: block; left: 7px; right: auto; top: 8px; bottom: 8px; width: 1px; height: auto; background: linear-gradient(to bottom, var(--gold), rgba(201,168,76,0.4)); }
      .tl li { padding: 0 0 0 36px; }
      .steps li { padding: 0 0 0 50px; min-height: 34px; }
      .protect { grid-template-columns: 1fr; padding: 26px 22px; gap: 16px; }
      .qa-btn { font-size: 1.15rem; }
      .qa-a p { padding-right: 8px; }
      .g-close { padding: 0 24px 64px; }
      .g-close .inner { padding: 48px 24px; }
      .trio { max-width: 170px; }
      .g-status { flex-direction: column; gap: 10px; }
    }
'''

SHIELD = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>'
TRIO = '''<svg class="trio" viewBox="0 0 240 220" aria-hidden="true">
  <circle class="halo" cx="120" cy="128" r="74"/>
  <line x1="120" y1="40" x2="44" y2="172"/><line x1="44" y1="172" x2="196" y2="172"/><line x1="196" y1="172" x2="120" y2="40"/>
  <line x1="120" y1="40" x2="120" y2="128"/><line x1="44" y1="172" x2="120" y2="128"/><line x1="196" y1="172" x2="120" y2="128"/>
  <circle class="node" cx="120" cy="40" r="11"/><circle class="node" cx="44" cy="172" r="11"/><circle class="node" cx="196" cy="172" r="11"/>
  <circle class="core" cx="120" cy="128" r="7"/>
</svg>'''
BRANCH = '''<svg class="branch" viewBox="0 0 300 170" aria-hidden="true">
  <path d="M150 34 L150 74 M150 74 L70 74 L70 112 M150 74 L230 74 L230 112"/>
  <path class="new" d="M230 132 L230 150 L262 150"/>
  <circle class="pres" cx="150" cy="22" r="13"/><circle cx="70" cy="122" r="11"/><circle cx="230" cy="122" r="11"/>
  <circle class="kid" cx="276" cy="150" r="10"/>
</svg>'''

def li(items): return ''.join(f'<li>{x}</li>' for x in items)
def esc(s): return H.escape(s, quote=False)

def build(code, d):
    t = T[code]; E = lambda k: esc(t[k])
    faq = open(os.path.join(REPO, d + 'faq.html'), encoding='utf-8').read()
    # Only the language selector points to the prototype in the other languages; every other link keeps its real page.
    def lang_to_proto(seg):
        return re.sub(r'href="([^"]*faq\.html)"', lambda m: 'href="@@G:' + posixpath.normpath(posixpath.join(d.rstrip('/') or '.', m.group(1))) + '"', seg)
    def swap(seg, a, b):
        part = block(seg, a, b); return seg.replace(part, lang_to_proto(part))
    nav = block(faq, '<!-- NAV -->', '</nav>').replace(' aria-current="page"', '')
    nav = swap(nav, '<!-- i18n:language-selector:header -->', '<!-- /i18n:language-selector:header -->')
    menu = block(faq, '<!-- MOBILE MENU -->', '<!-- /i18n:language-selector:menu -->\n  </div>').replace(' aria-current="page"', '')
    menu = swap(menu, '<!-- i18n:language-selector:menu -->', '<!-- /i18n:language-selector:menu -->')
    home = open(os.path.join(REPO, d + 'index.html'), encoding='utf-8').read()
    foot = block(home, '<!-- FOOTER -->', '</footer>')  # homepage footer: links to every public page, FAQ included
    fonts = re.search(r'<link href="https://fonts\.googleapis\.com/css2[^>]*>', faq).group(0)
    dev = f'<span class="dev">{E("dev")}</span>'
    def label(k, planned=True): return f'<p class="label">{E(k)}{dev if planned else ""}</p>'
    body = f'''
  <div class="proto" role="note">{E("proto_note")}</div>
  {nav}

  {menu}

  <main>
  <section class="g-hero" aria-labelledby="g-title">
    <div class="wrap">
      <div>
        <p class="label">{E("eyebrow")}</p>
        <h1 id="g-title">{t["h1"]}</h1>
        <p class="intro">{E("intro")}</p>
        <p class="principle">{E("principle")}</p>
        <p class="g-status"><span class="pill">{E("dev")}</span><span>{E("status")}</span></p>
      </div>
      {TRIO}
    </div>
  </section>

  <section class="g" id="role">
    <div class="wrap">
      {label("s2_label", False)}
      <h2>{t["s2_title"]}</h2>
      <div class="isnot">
        <div class="yes"><h3>{E("is_h")}</h3><ul class="tick">{li(map(esc, t["is_items"]))}</ul></div>
        <div><h3>{E("not_h")}</h3><ul class="cross">{li(map(esc, t["not_items"]))}</ul></div>
      </div>
      <p class="note">{E("s2_note")}</p>
    </div>
  </section>

  <section class="g" id="three">
    <div class="wrap">
      {label("s3_label")}
      <h2>{t["s3_title"]}</h2>
      <p class="lead">{E("s3_lead")}</p>
      <div class="three">{''.join(f'<div><span class="dot" aria-hidden="true"></span><h3>{esc(h)}</h3><p>{esc(p)}</p></div>' for h, p in t["s3_cards"])}</div>
    </div>
  </section>

  <section class="g" id="invitation">
    <div class="wrap">
      {label("s4_label")}
      <h2>{t["s4_title"]}</h2>
      <ol class="steps">{li(map(esc, t["s4_steps"]))}</ol>
      <p class="note">{E("s4_note")}</p>
    </div>
  </section>

  <section class="g warm" id="while-alive">
    <div class="wrap alive-grid">
      <div>
        {label("s5_label")}
        <h2>{t["s5_title"]}</h2>
        <p class="lead">{E("s5_lead")}</p>
        <p class="note">{E("s5_quote")}</p>
      </div>
      <div class="panel"><h3>{E("s5_cannot_h")}</h3><ul class="cross">{li(map(esc, t["s5_cannot"]))}</ul><p class="small">{E("s5_keep")}</p></div>
    </div>
  </section>

  <section class="g" id="if-a-death-is-reported">
    <div class="wrap">
      {label("s6_label")}
      <h2>{t["s6_title"]}</h2>
      <ol class="tl">{''.join(f'<li><span class="when">{esc(w)}</span><h3>{esc(h)}</h3><p>{esc(p)}</p></li>' for w, h, p in t["s6_steps"])}</ol>
      <div class="protect">
        <span class="shield">{SHIELD}</span>
        <div><h3>{E("s6_alive_h")}</h3><p>{E("s6_alive")}</p><p><strong>{E("s6_alive_strong")}</strong></p></div>
      </div>
      <p class="note">{E("s6_note")}</p>
    </div>
  </section>

  <section class="g warm" id="preserved">
    <div class="wrap">
      {label("s7_label")}
      <h2>{t["s7_title"]}</h2>
      <div class="two">
        <div class="panel"><h3>{E("s7_stays_h")}</h3><ul class="tick">{li(map(esc, t["s7_stays"]))}</ul></div>
        <div class="panel"><h3>{E("s7_cannot_h")}</h3><ul class="cross">{li(map(esc, t["s7_cannot"]))}</ul></div>
      </div>
      <p class="note">{E("s7_quote")}</p>
    </div>
  </section>

  <section class="g" id="family-tree">
    <div class="wrap tree-grid">
      <div>
        {label("s8_label")}
        <h2>{t["s8_title"]}</h2>
        <p class="lead">{E("s8_lead")}</p>
        {BRANCH}
      </div>
      <div>
        <ol class="vsteps">{li(map(esc, t["s8_steps"]))}</ol>
        <p class="callout">{E("s8_one")}</p>
        <p class="note">{E("s8_note")}</p>
      </div>
    </div>
  </section>

  <section class="g" id="visibility">
    <div class="wrap vis">
      <div>
        {label("s9_label")}
        <h2>{t["s9_title"]}</h2>
        <p class="lead">{E("s9_text")}</p>
        <p class="note">{E("s9_note")}</p>
      </div>
      <div class="msg" aria-hidden="true">
        <div class="row"><span class="av"></span><span class="av"></span><span class="av"></span></div>
        <div class="bubble"></div><div class="bubble" style="width:52%"></div>
      </div>
    </div>
  </section>

  <section class="g warm" id="when-things-change">
    <div class="wrap">
      {label("s10_label")}
      <h2>{t["s10_title"]}</h2>
      <div class="cards3">{''.join(f'<div><h3>{esc(h)}</h3><ul>{li(map(esc, items))}</ul></div>' for h, items in t["s10_cards"])}</div>
    </div>
  </section>

  <section class="g" id="support">
    <div class="wrap support-grid">
      <div>
        {label("s11_label")}
        <h2>{t["s11_title"]}</h2>
        <p class="lead">{E("s11_lead")}</p>
        <p class="note">{E("s11_note")}</p>
      </div>
      <div><ul class="dash">{li(map(esc, t["s11_items"]))}</ul><a class="mail" href="mailto:support@myeternusapp.com">support@myeternusapp.com</a></div>
    </div>
  </section>

  <section class="g" id="questions">
    <div class="wrap">
      {label("faq_label", False)}
      <h2>{t["faq_title"]}</h2>
      <div class="qa">{''.join(f'<div class="qa-item"><h3 style="margin:0;font-size:inherit"><button type="button" class="qa-btn" id="qa-b{i}" aria-expanded="false" aria-controls="qa-p{i}"><span>{esc(q)}</span><span class="qa-cue" aria-hidden="true"></span></button></h3><div class="qa-a" id="qa-p{i}" role="region" aria-labelledby="qa-b{i}"><div><p>{esc(a)}</p></div></div></div>' for i, (q, a) in enumerate(t["faq"]))}</div>
    </div>
  </section>

  <section class="g-close" aria-label="Eternus">
    <div class="inner"><h2>{t["close_title"]}</h2><p>{E("close_text")}</p></div>
  </section>
  </main>

  {foot}
'''
    script = '''
  <script>
    document.getElementById('year').textContent = new Date().getFullYear();
    (function () {
      var hamburger = document.getElementById('nav-hamburger'), mobileMenu = document.getElementById('mobile-menu');
      var openLabel = hamburger.getAttribute('aria-label'), closeLabel = hamburger.getAttribute('data-i18n-close-label');
      var nav = document.querySelector('body > nav');
      var upd = function () { nav.classList.toggle('nav-scrolled', window.scrollY > 8); };
      window.addEventListener('scroll', upd, { passive: true }); upd();
      function setMenu(open) {
        mobileMenu.classList.toggle('open', open); hamburger.classList.toggle('open', open);
        hamburger.setAttribute('aria-label', open ? closeLabel : openLabel);
        hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
        mobileMenu.setAttribute('aria-hidden', open ? 'false' : 'true');
      }
      hamburger.addEventListener('click', function () { setMenu(!mobileMenu.classList.contains('open')); });
      document.querySelectorAll('.mobile-link').forEach(function (l) { l.addEventListener('click', function () { setMenu(false); }); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && mobileMenu.classList.contains('open')) { setMenu(false); hamburger.focus(); } });
      // questions: one open at a time
      var items = Array.prototype.slice.call(document.querySelectorAll('.qa-item'));
      items.forEach(function (it) {
        var b = it.querySelector('.qa-btn');
        b.addEventListener('click', function () {
          var open = !it.classList.contains('open');
          items.forEach(function (o) { o.classList.remove('open'); o.querySelector('.qa-btn').setAttribute('aria-expanded', 'false'); });
          if (open) { it.classList.add('open'); b.setAttribute('aria-expanded', 'true'); }
        });
      });
    })();
  </script>'''
    page = f'''<!DOCTYPE html>
<html lang="{t["lang"]}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow, noarchive" />
  <!-- PROTOTYPE ONLY: not published, not linked, not in the sitemap. Source: Guardians functional specification, 26 Oct 2026. -->
  <title>{E("title")}</title>
  <meta name="theme-color" content="#ffffff" />
  <link rel="icon" href="{'../' if d else ''}favicon.ico" sizes="48x48" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  {fonts}
  <script>document.documentElement.classList.add('js');</script>
  {I18N_CSS}
  <style>
{HEADER_CSS}{PAGE_CSS}
{FOOTER_CSS}
  </style>
</head>
<body>
{body}
{script}
</body>
</html>
'''
    new_dir = posixpath.join(OUT, d.rstrip('/')) if d else OUT
    page = relocate(page, d.rstrip('/') if d else '', new_dir)
    page = re.sub(r'@@G:([^"]+)', lambda m: posixpath.relpath(posixpath.join(OUT, posixpath.dirname(m.group(1)), 'guardians.html'), new_dir), page)
    os.makedirs(os.path.join(REPO, new_dir), exist_ok=True)
    out = os.path.join(REPO, new_dir, 'guardians.html')
    open(out, 'w', encoding='utf-8').write(page)
    print('written', posixpath.join(new_dir, 'guardians.html'), len(page))

for code, d in LANGS.items():
    build(code, d)
