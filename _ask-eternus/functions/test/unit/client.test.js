import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ASK_ROOT } from './helpers.js';

// The published client lives with the website assets (support.html loads it).
const src = readFileSync(join(ASK_ROOT, '..', 'assets', 'js', 'ask-eternus.js'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('client: Fraud Defense (reCAPTCHA Enterprise) provider, auto-refresh off, limited-use tokens', () => {
  assert.match(src, /new ReCaptchaEnterpriseProvider\(config\.recaptchaSiteKey\)/);
  assert.match(src, /isTokenAutoRefreshEnabled: false/);
  assert.match(src, /limitedUseAppCheckTokens: true/);
  assert.match(src, /getFunctions\(app, 'europe-west1'\)/);
});

test('client: no debug token, no secrets, no HTML injection, one pinned SDK version', () => {
  assert.ok(!/FIREBASE_APPCHECK_DEBUG_TOKEN/.test(src));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code));
  assert.ok(!/AIza[0-9A-Za-z_-]{20,}|private_key|BEGIN PRIVATE/.test(src));
  const versions = new Set([...src.matchAll(/firebasejs\/(\d+\.\d+\.\d+)\//g)].map((m) => m[1]));
  assert.deepEqual([...versions], ['12.19.0']);
});
