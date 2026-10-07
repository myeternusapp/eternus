import { termRegex } from './terms.js';
import { LIMITS } from './config.js';
import { MODEL_KINDS } from './prompt.js';

// Kinds whose model text is shown; every other kind is answered with a server template.
export const MODEL_TEXT_KINDS = new Set(['current', 'clarify', 'assistant_policy']);
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;
const ALLOWED_HOSTS = new Set(['myeternusapp.com', 'app.myeternusapp.com']);
const ALLOWED_EMAILS = new Set(['support@myeternusapp.com', 'privacy@myeternusapp.com', 'hello@myeternusapp.com']);
const HOSTLIKE = /(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/[^\s]*)?/giu;
const EMAILLIKE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
const MARKUP = /<\/?[a-z][^>]*>|\]\(|^#{1,6}\s/imu;

export function compileFilters(kb) {
  return kb.answerFilters.map((term) => ({ term, rx: termRegex(term) }));
}

/**
 * Validates the raw model result. Returns { ok: true, kind, language, answer, sources } or
 * { ok: false, reason } where reason names the failed rule (logged; never the content).
 */
export function validateModelOutput(result, kb, filters) {
  if (result.finishReason !== 'STOP') return { ok: false, reason: `finish_${String(result.finishReason).toLowerCase()}` };
  let out;
  try { out = JSON.parse(result.text); } catch { return { ok: false, reason: 'json' }; }
  if (!out || typeof out !== 'object' || Array.isArray(out)) return { ok: false, reason: 'json_shape' };

  const { kind, language, answer, sources } = out;
  if (!MODEL_KINDS.includes(kind)) return { ok: false, reason: 'kind' };
  if (typeof language !== 'string' || !LANGUAGE.test(language)) return { ok: false, reason: 'language' };
  if (!Array.isArray(sources)) return { ok: false, reason: 'sources_shape' };
  if (sources.length > LIMITS.maxSources) return { ok: false, reason: 'sources_count' };

  const seen = new Set();
  const cleanSources = [];
  for (const s of sources) {
    if (!s || typeof s.id !== 'string' || !kb.titles[s.id]) return { ok: false, reason: 'source_id' };
    if (seen.has(s.id)) return { ok: false, reason: 'source_duplicate' };
    seen.add(s.id);
    cleanSources.push({ id: s.id, title: displayTitle(s.title, kb.titles[s.id], language, filters) });
  }

  if (!MODEL_TEXT_KINDS.has(kind)) return { ok: true, kind, language, answer: null, sources: cleanSources };

  if (kind !== 'assistant_policy' && cleanSources.length === 0) return { ok: false, reason: 'sources_missing' };
  if (typeof answer !== 'string') return { ok: false, reason: 'answer_type' };
  const text = answer.trim();
  if (!text) return { ok: false, reason: 'answer_empty' };
  if ([...text].length > LIMITS.answerMaxChars) return { ok: false, reason: 'answer_length' };
  const bad = contentViolation(text, filters);
  if (bad) return { ok: false, reason: bad };
  return { ok: true, kind, language, answer: text, sources: cleanSources };
}

/** Language-independent content rules applied to any text we show. */
export function contentViolation(text, filters) {
  if (MARKUP.test(text)) return 'markup';
  for (const m of text.matchAll(EMAILLIKE)) if (!ALLOWED_EMAILS.has(m[0].toLowerCase())) return 'email';
  const withoutEmails = text.replace(EMAILLIKE, ' ');
  for (const m of withoutEmails.matchAll(HOSTLIKE)) if (!ALLOWED_HOSTS.has(m[1].toLowerCase())) return 'host';
  for (const f of filters) if (f.rx.test(text)) return 'filter';
  return null;
}

// Translated titles are shown to the visitor (D15); the canonical English title is the fallback.
function displayTitle(title, canonical, language, filters) {
  if (language.split('-')[0] === 'en') return canonical;
  if (typeof title !== 'string') return canonical;
  const t = title.trim();
  if (!t || [...t].length > LIMITS.titleMaxChars || /\n/.test(t) || contentViolation(t, filters)) return canonical;
  return t;
}
