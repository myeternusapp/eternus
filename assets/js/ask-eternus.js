// Ask Eternus browser client (ES module), loaded by support.html on first use. Holds no secrets:
// the page passes only public identifiers (Firebase web config and the reCAPTCHA site key).
//
// App Check: reCAPTCHA Enterprise (Google Cloud Fraud Defense) provider, auto-refresh OFF, and a
// fresh limited-use token per question (the backend consumes it: replay protection).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';

export const MAX_QUESTION_CHARS = 500;

/** Code points, as the server counts them. */
export const questionLength = (s) => [...String(s ?? '').trim()].length;

/**
 * config: { firebase: { apiKey, authDomain, projectId, appId }, recaptchaSiteKey }
 * Returns { ask(question) } where ask resolves to the server response object, or to
 * { ok: false, kind: 'invalid_input' | 'error' } when the request is not made or fails.
 */
export function initAskEternus(config) {
  const app = initializeApp(config.firebase, 'ask-eternus');
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(config.recaptchaSiteKey),
    isTokenAutoRefreshEnabled: false,
  });
  const call = httpsCallable(getFunctions(app, 'europe-west1'), 'askEternus', {
    limitedUseAppCheckTokens: true,
    timeout: 25_000,
  });
  return {
    async ask(question) {
      const q = String(question ?? '').trim();
      if (!q || questionLength(q) > MAX_QUESTION_CHARS) return { ok: false, kind: 'invalid_input' };
      const payload = { question: q, locale: navigator.language || null, v: 1 };
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await call(payload);
          return res.data;
        } catch (e) {
          const code = typeof e?.code === 'string' ? e.code : 'error';
          // A network failure while fetching the App Check token happens before anything reaches
          // Ask Eternus, so one retry cannot duplicate a question. Nothing else is retried.
          if (code === 'appCheck/fetch-network-error' && attempt === 0) {
            await new Promise((r) => setTimeout(r, 800));
            continue;
          }
          // Error code only (for diagnosis); never the question, tokens or response content.
          console.warn('Ask Eternus request failed:', code);
          return { ok: false, kind: 'error' };
        }
      }
    },
  };
}

/**
 * Renders a response with text nodes only (never innerHTML). Paragraphs are separated by blank
 * lines; lines starting with "- " become a list. `labels.fallback` is used when the response has
 * no answer text (for example, when the request failed before reaching the service).
 */
export function renderAnswer(container, response, labels = { sources: 'Based on', fallback: 'Please contact support@myeternusapp.com.' }) {
  container.replaceChildren();
  const text = typeof response?.answer === 'string' && response.answer.trim() ? response.answer : labels.fallback;
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim());
    let list = null;
    for (const line of lines) {
      if (/^\s*-\s+/.test(line)) {
        if (!list) { list = document.createElement('ul'); container.append(list); }
        const li = document.createElement('li');
        li.textContent = line.replace(/^\s*-\s+/, '');
        list.append(li);
      } else {
        list = null;
        const p = document.createElement('p');
        p.textContent = line;
        container.append(p);
      }
    }
  }
  if (Array.isArray(response?.sources) && response.sources.length) {
    const box = document.createElement('div');
    box.className = 'ask-sources';
    const h = document.createElement('p');
    h.className = 'ask-sources-label';
    h.textContent = labels.sources;
    const ul = document.createElement('ul');
    for (const s of response.sources) {
      const li = document.createElement('li');
      li.textContent = String(s?.title ?? '');
      ul.append(li);
    }
    box.append(h, ul);
    container.append(box);
  }
  if (typeof response?.language === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(response.language)) {
    container.lang = response.language;
  } else {
    container.removeAttribute('lang');
  }
}
