import { LIMITS, MODEL_ID, MODEL_RETRY, VERTEX_HOST, VERTEX_LOCATION } from './config.js';

export class ModelError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function generateContentUrl(projectId, model = MODEL_ID) {
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(projectId ?? '')) throw new ModelError('bad_project');
  return `https://${VERTEX_HOST}/v1/projects/${projectId}/locations/${VERTEX_LOCATION}/publishers/google/models/${model}:generateContent`;
}

export function requestBody({ system, user, schema }) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      maxOutputTokens: LIMITS.maxOutputTokens,
      temperature: 0.2,
      candidateCount: 1,
      thinkingConfig: { thinkingLevel: 'MINIMAL' },
    },
  };
}

/**
 * Vertex AI generateContent over REST, EU multi-region only.
 * deps: { projectId, getAccessToken: async () => string, fetch, timeoutMs, now, sleep, random }
 * generate(parts, { deadlineAt }) returns { text, finishReason, usage, retries }; throws ModelError
 * (with `retries`) on any failure. HTTP 429/503 get one retry, only while `deadlineAt` (epoch ms,
 * the request's overall budget) leaves room for it; each attempt is cut off at the deadline.
 * Without a deadline there is a single attempt. Errors never include the prompt or response body.
 */
export function vertexModel({
  projectId, getAccessToken, fetch: doFetch = fetch, timeoutMs = LIMITS.modelTimeoutMs,
  now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), random = Math.random,
}) {
  const url = generateContentUrl(projectId);
  if (new URL(url).hostname !== VERTEX_HOST) throw new ModelError('bad_host');

  async function attempt(token, parts, ms) {
    if (!(ms > 0)) throw new ModelError('timeout');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    let res;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody(parts)),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new ModelError(e?.name === 'AbortError' ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new ModelError(`http_${res.status}`);
    let json;
    try { json = await res.json(); } catch { throw new ModelError('bad_response'); }
    return parseGenerateContent(json);
  }

  return {
    url,
    async generate(parts, { deadlineAt } = {}) {
      let token;
      try { token = await getAccessToken(); } catch { throw Object.assign(new ModelError('auth'), { retries: 0 }); }
      const deadline = deadlineAt ?? now() + timeoutMs;
      for (let retries = 0; ; retries++) {
        try {
          return { ...(await attempt(token, parts, Math.min(timeoutMs, deadline - now()))), retries };
        } catch (e) {
          const err = e instanceof ModelError ? e : new ModelError('error');
          const delay = MODEL_RETRY.minDelayMs + Math.floor(random() * (MODEL_RETRY.maxDelayMs - MODEL_RETRY.minDelayMs));
          const retry = deadlineAt !== undefined && MODEL_RETRY.codes.includes(err.code) && retries < MODEL_RETRY.max
            && deadline - now() - delay >= MODEL_RETRY.minAttemptMs;
          if (!retry) throw Object.assign(err, { retries });
          await sleep(delay);
        }
      }
    },
  };
}

export function parseGenerateContent(json) {
  const usage = usageOf(json?.usageMetadata);
  if (json?.promptFeedback?.blockReason) return { text: '', finishReason: 'BLOCKED', usage };
  const cand = json?.candidates?.[0];
  const text = (cand?.content?.parts ?? [])
    .filter((p) => typeof p.text === 'string' && p.thought !== true)
    .map((p) => p.text)
    .join('');
  return { text, finishReason: cand?.finishReason ?? 'MISSING', usage };
}

function usageOf(u) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return {
    promptTokens: n(u?.promptTokenCount),
    cachedTokens: n(u?.cachedContentTokenCount),
    outputTokens: n(u?.candidatesTokenCount),
    thoughtTokens: n(u?.thoughtsTokenCount),
  };
}
