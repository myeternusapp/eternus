import { createHash, createHmac } from 'node:crypto';
import net from 'node:net';
import { LIMITS, RATE_LIMIT_COLLECTION, RATE_LIMIT_TTL_MS } from './config.js';

export const IP_SOURCES = ['first', 'last'];

/**
 * Picks the client IP from X-Forwarded-For. `source` must be chosen from the staging test that
 * shows which entry Google itself appends ("first" or "last"); never a value the visitor controls.
 * Returns null when no valid IP is present (the request is then rejected, fail closed).
 */
export function clientIp(xff, source) {
  if (!IP_SOURCES.includes(source)) throw new Error('RATE_LIMIT_IP_SOURCE must be "first" or "last"');
  if (typeof xff !== 'string' || !xff.trim()) return null;
  const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
  const raw = source === 'first' ? parts[0] : parts[parts.length - 1];
  return normalizeIp(raw);
}

/**
 * Diagnostic for the staging gate that decides RATE_LIMIT_IP_SOURCE, without logging any IP:
 * the number of entries, and whether the first entry is a reserved documentation address
 * (RFC 5737 TEST-NET-1/2/3, never a real visitor) that the test sends as a forged header.
 */
export function xffDiagnostic(xff) {
  const parts = typeof xff === 'string' ? xff.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const testNet = /^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/.test(parts[0] ?? '');
  return { xffEntries: parts.length, xffFirstTestNet: testNet ? 'yes' : 'no' };
}

export function normalizeIp(raw) {
  if (!raw) return null;
  let ip = raw.replace(/^\[|\](?::\d+)?$/g, '');           // [v6]:port -> v6
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.replace(/:\d+$/, ''); // v4:port -> v4
  ip = ip.replace(/%.*$/, '');                              // zone id
  const v = net.isIP(ip);
  if (v === 4) return ip;
  if (v !== 6) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped && net.isIP(mapped[1]) === 4) return mapped[1];
  return ipv6Prefix64(ip);
}

function ipv6Prefix64(ip) {
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':') + '::/64';
}

/** Daily-rotating, non-reversible client key: HMAC-SHA256(secret, utcDate|ip) truncated to 128 bits. */
export function clientKey(ip, secret, now = new Date()) {
  if (!secret || secret.length < 32) throw new Error('RATE_LIMIT_HMAC_KEY missing or too short');
  return createHmacSha256(secret, `${utcDay(now)}|${ip}`).slice(0, 32);
}

function createHmacSha256(secret, msg) {
  return createHmac('sha256', secret).update(msg).digest('hex');
}

/** Replay record id for one App Check token: a SHA-256 of app id and jti, never the jti itself. */
export function replayDocId(appId, jti) {
  return `r_${createHash('sha256').update(`${appId}|${jti}`).digest('hex')}`;
}

export const utcDay = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
const utcHour = (d) => d.toISOString().slice(0, 13).replace(/[-T]/g, '');
const utcMinute = (d) => d.toISOString().slice(0, 16).replace(/[-T:]/g, '');

/** Counter document ids and limits for one request. */
export function buckets(key, now, cfg) {
  const pc = cfg.perClient ?? LIMITS.perClient;
  return [
    { id: `c_${key}_m${utcMinute(now)}`, limit: pc.minute, scope: 'client_minute' },
    { id: `c_${key}_h${utcHour(now)}`, limit: pc.hour, scope: 'client_hour' },
    { id: `c_${key}_d${utcDay(now)}`, limit: pc.day, scope: 'client_day' },
    { id: `g_m${utcMinute(now)}`, limit: cfg.globalPerMinute, scope: 'global_minute' },
    { id: `g_d${utcDay(now)}`, limit: cfg.dailyLimit, scope: 'global_day' },
  ];
}

/**
 * Reserves one request against all buckets atomically: either every counter is incremented, or
 * none is and the first exhausted scope is returned. `store.transact(ids, fn)` gives the current
 * counts and applies the increments; see firestoreStore / memoryStore.
 */
export async function reserve(store, key, now, cfg) {
  const bs = buckets(key, now, cfg);
  return store.transact(bs.map((b) => b.id), (counts) => {
    const hit = bs.find((b, i) => counts[i] >= b.limit);
    if (hit) return { allowed: false, scope: hit.scope, retryAfterSeconds: retryAfter(hit.scope, now) };
    return { allowed: true, increments: bs.map((b) => b.id), expiresAt: new Date(now.getTime() + RATE_LIMIT_TTL_MS) };
  });
}

function retryAfter(scope, now) {
  const s = now.getUTCSeconds(), m = now.getUTCMinutes(), h = now.getUTCHours();
  if (scope.endsWith('minute')) return 60 - s;
  if (scope.endsWith('hour')) return (59 - m) * 60 + (60 - s);
  return (23 - h) * 3600 + (59 - m) * 60 + (60 - s);
}

/** Firestore (Admin SDK) store: one transaction reads all counters and writes only on success. */
export function firestoreStore(db) {
  const col = db.collection(RATE_LIMIT_COLLECTION);
  return {
    async transact(ids, decide) {
      return db.runTransaction(async (tx) => {
        const refs = ids.map((id) => col.doc(id));
        const snaps = await tx.getAll(...refs);
        const counts = snaps.map((s) => (s.exists ? s.get('count') ?? 0 : 0));
        const r = decide(counts);
        if (r.allowed) {
          refs.forEach((ref, i) => tx.set(ref, { count: counts[i] + 1, expiresAt: r.expiresAt }, { merge: true }));
        }
        return { allowed: r.allowed, scope: r.scope, retryAfterSeconds: r.retryAfterSeconds };
      });
    },
    /** Atomic create: true for the first claim of `id`, false if it already exists (a replay). */
    async claimOnce(id, expiresAt) {
      try {
        await col.doc(id).create({ expiresAt });
        return true;
      } catch (e) {
        if (e?.code === 6) return false; // gRPC ALREADY_EXISTS
        throw e;
      }
    },
  };
}

/** In-memory store for unit tests. */
export function memoryStore() {
  const docs = new Map();
  return {
    docs,
    async transact(ids, decide) {
      const counts = ids.map((id) => docs.get(id)?.count ?? 0);
      const r = decide(counts);
      if (r.allowed) ids.forEach((id, i) => docs.set(id, { count: counts[i] + 1, expiresAt: r.expiresAt }));
      return { allowed: r.allowed, scope: r.scope, retryAfterSeconds: r.retryAfterSeconds };
    },
    async claimOnce(id, expiresAt) {
      if (docs.has(id)) return false;
      docs.set(id, { expiresAt });
      return true;
    },
  };
}
