// One structured log line per request. Only allow-listed fields are ever written: no question
// text, answer text, IP, client key, user agent, token or headers can pass through here.
const ALLOWED = new Set([
  'requestId', 'kind', 'status', 'reason', 'latencyMs', 'modelLatencyMs', 'modelRetries', 'promptTokens', 'cachedTokens',
  'outputTokens', 'thoughtTokens', 'sources', 'kbVersion', 'model', 'lengthBucket', 'language', 'redactions',
  'rateLimitScope', 'xffEntries', 'xffFirstTestNet',
]);
const SAFE_STRING = /^[A-Za-z0-9_.:-]{0,64}$/;

export function sanitizeLogEntry(entry) {
  const out = { event: 'askEternus' };
  for (const [k, v] of Object.entries(entry ?? {})) {
    if (!ALLOWED.has(k) || v === undefined || v === null) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string' && SAFE_STRING.test(v)) out[k] = v;
    else if (k === 'sources' && Array.isArray(v)) out[k] = v.filter((s) => typeof s === 'string' && SAFE_STRING.test(s)).slice(0, 4);
  }
  return out;
}

export function jsonLogger(write = (line) => console.log(line)) {
  return (entry) => write(JSON.stringify(sanitizeLogEntry(entry)));
}
