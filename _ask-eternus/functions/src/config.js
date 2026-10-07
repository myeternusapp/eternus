// Fixed Ask Eternus settings. Runtime-tunable values (kill switch, daily limit) live in the
// server-side Firestore document config/askEternus and are read by runtimeConfig().

export const REGION = 'europe-west1';
export const ALLOWED_ORIGIN = 'https://myeternusapp.com';

// Vertex AI, EU multi-region: ML processing stays inside the EU. The host is pinned here and
// asserted before every request (see vertex.js); never derived from an SDK default.
export const VERTEX_HOST = 'aiplatform.eu.rep.googleapis.com';
export const VERTEX_LOCATION = 'eu';
export const MODEL_ID = 'gemini-3.5-flash-lite';

export const LIMITS = Object.freeze({
  questionMaxChars: 500,
  questionMaxLines: 20,
  localeMaxChars: 15,
  payloadMaxBytes: 2048,
  answerMaxChars: 1200,
  titleMaxChars: 120,
  maxSources: 4,
  maxOutputTokens: 600,
  modelTimeoutMs: 12_000,
  // Overall budget for one request, from handler start to the end of the model call (including a
  // retry). The function timeout is 20 s; App Check verification runs before the handler starts.
  requestBudgetMs: 17_000,
  perClient: { minute: 3, hour: 15, day: 40 },
});

// Transient Vertex responses get exactly one retry, after a jittered pause, and only when the
// request budget still leaves a useful attempt.
export const MODEL_RETRY = Object.freeze({
  max: 1,
  codes: Object.freeze(['http_429', 'http_503']),
  minDelayMs: 1000,
  maxDelayMs: 2000,
  minAttemptMs: 3000,
});

// Defaults apply when the config document is missing: Ask Eternus starts disabled.
export const RUNTIME_DEFAULTS = Object.freeze({
  enabled: false,
  dailyLimit: 75,
  globalPerMinute: 30,
  perClient: LIMITS.perClient,
});
export const CONFIG_CACHE_MS = 30_000;

export const CONFIG_DOC = 'config/askEternus';
export const RATE_LIMIT_COLLECTION = 'askRateLimits';
export const RATE_LIMIT_TTL_MS = 48 * 60 * 60 * 1000;
// Replay records live in RATE_LIMIT_COLLECTION (same TTL policy) until the token's own exp plus
// this margin for clock skew; after exp the SDK rejects the token anyway.
export const REPLAY_TTL_MARGIN_MS = 5 * 60 * 1000;

export const SUPPORT_EMAIL = 'support@myeternusapp.com';

/**
 * Reads config/askEternus through `getDoc` (an async function returning the document data or
 * undefined), caching it for CONFIG_CACHE_MS. Any read failure or invalid value fails closed.
 */
export function runtimeConfigReader(getDoc, now = () => Date.now()) {
  let cached = null;
  let at = 0;
  return async function runtimeConfig() {
    if (cached && now() - at < CONFIG_CACHE_MS) return cached;
    let value;
    try {
      value = sanitizeRuntimeConfig(await getDoc());
    } catch {
      value = { ...RUNTIME_DEFAULTS, enabled: false };
    }
    cached = value;
    at = now();
    return value;
  };
}

export function sanitizeRuntimeConfig(data) {
  const d = data && typeof data === 'object' ? data : {};
  const int = (v, fallback, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : fallback);
  return {
    enabled: d.enabled === true,
    dailyLimit: int(d.dailyLimit, RUNTIME_DEFAULTS.dailyLimit, 100_000),
    globalPerMinute: int(d.globalPerMinute, RUNTIME_DEFAULTS.globalPerMinute, 10_000),
    // Server-only override for an approved test window (e.g. the staging eval); defaults otherwise.
    perClient: {
      minute: int(d.perClient?.minute, LIMITS.perClient.minute, 10_000),
      hour: int(d.perClient?.hour, LIMITS.perClient.hour, 100_000),
      day: int(d.perClient?.day, LIMITS.perClient.day, 100_000),
    },
  };
}
