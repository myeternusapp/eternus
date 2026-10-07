import { LIMITS } from './config.js';

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿]/g;
const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Runs of 6+ digits, optionally separated by spaces, dots, dashes or parentheses, with an
// optional leading +: phone numbers, codes, card or account numbers.
const NUMBER = /\+?\d(?:[\s().-]*\d){5,}/g;

/**
 * Validates and normalizes the callable payload. Returns { ok: true, question, locale, redacted }
 * or { ok: false, reason }. Never echoes the input in the reason.
 */
export function parseInput(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'invalid_payload' };
  let size;
  try { size = Buffer.byteLength(JSON.stringify(data), 'utf8'); } catch { return { ok: false, reason: 'invalid_payload' }; }
  if (size > LIMITS.payloadMaxBytes) return { ok: false, reason: 'payload_too_large' };
  if (data.v !== undefined && data.v !== 1) return { ok: false, reason: 'unsupported_version' };
  if (typeof data.question !== 'string') return { ok: false, reason: 'missing_question' };

  const question = normalizeText(data.question);
  if (question.length === 0) return { ok: false, reason: 'empty_question' };
  if ([...question].length > LIMITS.questionMaxChars) return { ok: false, reason: 'question_too_long' };
  if (question.split('\n').length > LIMITS.questionMaxLines) return { ok: false, reason: 'too_many_lines' };

  let locale = null;
  if (data.locale !== undefined && data.locale !== null) {
    if (typeof data.locale !== 'string' || data.locale.length > LIMITS.localeMaxChars || !LOCALE.test(data.locale)) {
      return { ok: false, reason: 'invalid_locale' };
    }
    locale = data.locale;
  }

  const { text, redacted } = redact(question);
  return { ok: true, question: text, locale, redacted, lengthBucket: lengthBucket(question) };
}

export function normalizeText(s) {
  return s.normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, '')
    .replace(INVISIBLE, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Replaces emails and long digit runs before anything leaves our server. */
export function redact(s) {
  let redacted = 0;
  const text = s
    .replace(EMAIL, () => { redacted++; return '[email]'; })
    .replace(NUMBER, () => { redacted++; return '[number]'; });
  return { text, redacted };
}

export function lengthBucket(s) {
  const n = [...s].length;
  return n <= 100 ? '0-100' : n <= 250 ? '101-250' : '251-500';
}
