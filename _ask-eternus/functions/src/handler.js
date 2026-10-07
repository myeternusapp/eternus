import { randomUUID } from 'node:crypto';
import { ALLOWED_ORIGIN, LIMITS, MODEL_ID, REPLAY_TTL_MARGIN_MS } from './config.js';
import { parseInput } from './input.js';
import { MODEL_TEXT_KINDS, validateModelOutput } from './output.js';
import { responseSchema, systemInstruction, userContent } from './prompt.js';
import { clientIp, clientKey, replayDocId, reserve, xffDiagnostic } from './ratelimit.js';
import { template, templateLanguage } from './templates.js';

/** Thrown for requests that must not get a normal answer (mapped to HttpsError in index.js). */
export class Rejected extends Error {
  constructor(code) { super(code); this.code = code; }
}

/**
 * Handles one Ask Eternus request. Order: App Check result → origin → replay record →
 * kill switch / KB → input → rate limits → model → output validation → response. Pure apart
 * from `deps`.
 *
 * req:  { data, app, headers }   (headers: lower-case names)
 * deps: { appId, kb, filters, runtimeConfig, store, model, hmacKey, ipSource, log, now, newId }
 */
export async function handleAsk(req, deps) {
  const started = deps.now();
  const requestId = deps.newId?.() ?? randomUUID();
  const entry = { requestId, kbVersion: deps.kb?.kbVersion, model: MODEL_ID };
  const finish = (response, extra) => {
    deps.log({ ...entry, ...extra, kind: response.kind, latencyMs: deps.now() - started });
    return { ...response, requestId };
  };

  // 1. App Check: enforceAppCheck already rejected missing/invalid tokens. Replay protection does
  //    not reject consumed tokens by itself; we must.
  if (!req.app || req.app.alreadyConsumed !== false) {
    deps.log({ ...entry, status: 'blocked', reason: req.app ? 'appcheck_consumed' : 'appcheck_missing' });
    throw new Rejected('unauthenticated');
  }
  if (!deps.appId || req.app.appId !== deps.appId) {
    deps.log({ ...entry, status: 'blocked', reason: 'appcheck_app' });
    throw new Rejected('unauthenticated');
  }
  // 2. Origin: a cheap browser filter on top of App Check, never authentication.
  if (req.headers?.origin !== ALLOWED_ORIGIN) {
    deps.log({ ...entry, status: 'blocked', reason: 'origin' });
    throw new Rejected('permission-denied');
  }

  const hintLang = templateLanguage(typeof req.data?.locale === 'string' ? req.data.locale : 'en');

  // 2b. Replay record: the deterministic second layer behind Google's consumption check, which has
  //     been observed to report reused tokens as unconsumed. One atomic create per token jti, so a
  //     token is answered at most once. Runs before the kill switch so it can be verified while
  //     disabled; only a hash of the jti is stored, kept until the token's own exp plus a margin.
  const { jti, exp } = req.app.token ?? {};
  if (typeof jti !== 'string' || !jti) {
    deps.log({ ...entry, status: 'blocked', reason: 'appcheck_no_jti' });
    throw new Rejected('unauthenticated');
  }
  if (!Number.isFinite(exp)) {
    deps.log({ ...entry, status: 'blocked', reason: 'appcheck_no_exp' });
    throw new Rejected('unauthenticated');
  }
  let claimed;
  try {
    claimed = await deps.store.claimOnce(replayDocId(deps.appId, jti), new Date(exp * 1000 + REPLAY_TTL_MARGIN_MS));
  } catch {
    return finish(blocked('unavailable', hintLang), { status: 'blocked', reason: 'replay_store' });
  }
  if (!claimed) {
    deps.log({ ...entry, status: 'blocked', reason: 'appcheck_replay' });
    throw new Rejected('unauthenticated');
  }

  // 3. Kill switch and grounding source.
  const cfg = await deps.runtimeConfig();
  if (!cfg.enabled) return finish(blocked('unavailable', hintLang), { status: 'blocked', reason: 'disabled' });
  if (!deps.kb) return finish(blocked('unavailable', hintLang), { status: 'blocked', reason: 'kb_invalid' });

  // 4. Input.
  const input = parseInput(req.data);
  if (!input.ok) return finish(blocked('invalid_input', hintLang), { status: 'blocked', reason: input.reason });
  Object.assign(entry, { lengthBucket: input.lengthBucket, redactions: input.redacted });

  // 5. Rate limits (per client and global). No IP, no key in logs.
  const now = new Date(deps.now());
  Object.assign(entry, xffDiagnostic(req.headers?.['x-forwarded-for']));
  const ip = clientIp(req.headers?.['x-forwarded-for'], deps.ipSource);
  if (!ip) return finish(blocked('unavailable', hintLang), { status: 'blocked', reason: 'no_client_ip' });
  let rl;
  try {
    rl = await reserve(deps.store, clientKey(ip, deps.hmacKey, now), now, cfg);
  } catch {
    return finish(blocked('unavailable', hintLang), { status: 'blocked', reason: 'rate_limit_store' });
  }
  if (!rl.allowed) {
    const global = rl.scope.startsWith('global');
    const r = global ? blocked('unavailable', hintLang) : { ...blocked('rate_limited', hintLang), retryAfterSeconds: rl.retryAfterSeconds };
    return finish(r, { status: 'blocked', reason: 'rate_limited', rateLimitScope: rl.scope });
  }

  // 6. Model.
  const t0 = deps.now();
  let result;
  try {
    result = await deps.model.generate({
      system: systemInstruction(deps.kb),
      user: userContent(input.question, input.locale),
      schema: responseSchema(deps.kb),
    }, { deadlineAt: started + LIMITS.requestBudgetMs });
  } catch (e) {
    return finish(blocked('error', hintLang), { status: 'fallback', reason: `model_${e?.code ?? 'error'}`, modelLatencyMs: deps.now() - t0, modelRetries: e?.retries });
  }
  Object.assign(entry, { modelLatencyMs: deps.now() - t0, modelRetries: result.retries, ...result.usage });

  // 7. Output validation; anything wrong becomes the `unknown` template.
  const v = validateModelOutput(result, deps.kb, deps.filters);
  if (!v.ok) {
    return finish(answerFromTemplate('unknown', hintLang), { status: 'fallback', reason: `validation_${v.reason}` });
  }
  if (!MODEL_TEXT_KINDS.has(v.kind)) {
    const r = answerFromTemplate(v.kind, v.language);
    return finish(r, { status: 'answered', language: r.language });
  }
  return finish(
    { ok: true, kind: v.kind, answer: v.answer, language: v.language, sources: v.sources, kbVersion: deps.kb.kbVersion },
    { status: 'answered', language: v.language, sources: v.sources.map((s) => s.id) },
  );

  function answerFromTemplate(kind, lang) {
    const t = template(kind, lang);
    return { ok: true, kind, answer: t.text, language: t.language, sources: [], kbVersion: deps.kb.kbVersion };
  }
}

function blocked(kind, lang) {
  const t = template(kind, lang);
  return { ok: false, kind, answer: t.text, language: t.language, contact: 'support@myeternusapp.com' };
}
