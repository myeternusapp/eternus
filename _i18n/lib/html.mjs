// Minimal, strict HTML tokenizer for the site's hand-written pages. It keeps source offsets for
// every node so callers can splice replacements into the original text and leave everything else
// byte-for-byte untouched. It throws on mismatched tags instead of guessing.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);

function lineOf(src, i) {
  return src.slice(0, i).split('\n').length;
}

function parseAttrs(src, from, to) {
  const attrs = [];
  const re = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  re.lastIndex = from;
  let m;
  while ((m = re.exec(src)) && m.index < to) {
    const raw = m[0];
    let value = null, valueStart = -1, quote = '';
    if (m[2] !== undefined || m[3] !== undefined || m[4] !== undefined) {
      value = m[2] ?? m[3] ?? m[4];
      quote = m[2] !== undefined ? '"' : m[3] !== undefined ? "'" : '';
      valueStart = m.index + raw.length - value.length - quote.length;
    }
    attrs.push({ name: m[1].toLowerCase(), value, valueStart, valueEnd: valueStart + (value?.length ?? 0), quote });
  }
  return attrs;
}

/** Parses `src` into a tree of { type: 'root' | 'element' | 'text' | 'comment' | 'doctype' } nodes. */
export function parse(src) {
  const root = { type: 'root', tag: '#root', children: [], start: 0, end: src.length, parent: null };
  let cur = root;
  let i = 0;
  const pushText = (a, b) => { if (b > a) cur.children.push({ type: 'text', start: a, end: b, parent: cur }); };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { pushText(i, src.length); break; }
    pushText(i, lt);

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      if (end === -1) throw new Error(`Unclosed comment at line ${lineOf(src, lt)}`);
      cur.children.push({ type: 'comment', start: lt, end: end + 3, parent: cur });
      i = end + 3;
      continue;
    }
    if (src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt);
      cur.children.push({ type: 'doctype', start: lt, end: end + 1, parent: cur });
      i = end + 1;
      continue;
    }
    if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt);
      const tag = src.slice(lt + 2, end).trim().toLowerCase();
      if (cur.tag !== tag) {
        throw new Error(`Unexpected </${tag}> at line ${lineOf(src, lt)}; open element is <${cur.tag}> from line ${lineOf(src, cur.start)}`);
      }
      cur.closeStart = lt;
      cur.end = end + 1;
      cur = cur.parent;
      i = end + 1;
      continue;
    }
    if (!/[A-Za-z]/.test(src[lt + 1] ?? '')) { pushText(lt, lt + 1); i = lt + 1; continue; }

    // Start tag: find the closing '>' outside quoted attribute values.
    let j = lt + 1, q = null;
    for (; j < src.length; j++) {
      const c = src[j];
      if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
    }
    const nameMatch = /^[A-Za-z][A-Za-z0-9:-]*/.exec(src.slice(lt + 1, j));
    const tag = nameMatch[0].toLowerCase();
    const selfClosed = src[j - 1] === '/';
    const el = {
      type: 'element', tag, start: lt, openEnd: j + 1, end: j + 1, closeStart: j + 1,
      attrs: parseAttrs(src, lt + 1 + tag.length, selfClosed ? j - 1 : j), children: [], parent: cur,
    };
    cur.children.push(el);
    i = j + 1;
    if (VOID.has(tag) || selfClosed) continue;
    if (RAW_TEXT.has(tag)) {
      const close = src.toLowerCase().indexOf(`</${tag}`, i);
      if (close === -1) throw new Error(`Unclosed <${tag}> at line ${lineOf(src, lt)}`);
      if (close > i) el.children.push({ type: 'text', start: i, end: close, parent: el, raw: true });
      el.closeStart = close;
      el.end = src.indexOf('>', close) + 1;
      i = el.end;
      continue;
    }
    cur = el;
  }
  if (cur !== root) throw new Error(`Unclosed <${cur.tag}> from line ${lineOf(src, cur.start)}`);
  return root;
}

export function attr(el, name) {
  return el.attrs?.find((a) => a.name === name) ?? null;
}

export function* walk(node) {
  yield node;
  for (const c of node.children ?? []) yield* walk(c);
}

/** Applies [{ start, end, text }] replacements (non-overlapping) to `src`. */
export function splice(src, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = src;
  let floor = Infinity;
  for (const e of sorted) {
    if (e.end > floor) throw new Error(`Overlapping edits at offset ${e.start}`);
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    floor = e.start;
  }
  return out;
}
