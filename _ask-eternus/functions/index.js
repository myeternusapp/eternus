// Ask Eternus — public callable function (Cloud Functions v2, europe-west1).
// App Check is enforced and every token is consumed (replay protection); the handler rejects
// already-consumed tokens, which the SDK does not do by itself.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { GoogleAuth } from 'google-auth-library';
import { ALLOWED_ORIGIN, CONFIG_DOC, LIMITS, REGION, runtimeConfigReader } from './src/config.js';
import { handleAsk, Rejected } from './src/handler.js';
import { loadKb } from './src/kb.js';
import { jsonLogger } from './src/log.js';
import { compileFilters } from './src/output.js';
import { firestoreStore, IP_SOURCES } from './src/ratelimit.js';
import { vertexModel } from './src/vertex.js';

const RATE_LIMIT_HMAC_KEY = defineSecret('RATE_LIMIT_HMAC_KEY');
// Public identifier of the "Ask Eternus Web" Firebase app (App Check subject).
const ASK_ETERNUS_APP_ID = defineString('ASK_ETERNUS_APP_ID');
// Dedicated runtime service account (created in the next, approved step).
const ASK_ETERNUS_SERVICE_ACCOUNT = defineString('ASK_ETERNUS_SERVICE_ACCOUNT');
// Which X-Forwarded-For entry Google appends; set from the staging test, no default on purpose.
const RATE_LIMIT_IP_SOURCE = defineString('RATE_LIMIT_IP_SOURCE', {
  input: { select: { options: IP_SOURCES.map((value) => ({ value })) } },
});

initializeApp();
const db = getFirestore();
const kb = loadKb();
const filters = kb ? compileFilters(kb) : [];
const runtimeConfig = runtimeConfigReader(async () => (await db.doc(CONFIG_DOC).get()).data());
const store = firestoreStore(db);
const log = jsonLogger();
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
let model;

export const askEternus = onCall(
  {
    region: REGION,
    enforceAppCheck: true,
    consumeAppCheckToken: true,
    cors: [ALLOWED_ORIGIN],
    invoker: 'public',
    maxInstances: 2,
    concurrency: 20,
    timeoutSeconds: 20,
    memory: '512MiB',
    serviceAccount: ASK_ETERNUS_SERVICE_ACCOUNT,
    secrets: [RATE_LIMIT_HMAC_KEY],
  },
  async (request) => {
    model ??= vertexModel({
      projectId: process.env.GCLOUD_PROJECT,
      getAccessToken: async () => (await auth.getAccessToken()) ?? '',
      timeoutMs: LIMITS.modelTimeoutMs,
    });
    try {
      return await handleAsk(
        { data: request.data, app: request.app, headers: request.rawRequest.headers },
        {
          appId: ASK_ETERNUS_APP_ID.value(),
          kb,
          filters,
          runtimeConfig,
          store,
          model,
          hmacKey: RATE_LIMIT_HMAC_KEY.value(),
          ipSource: RATE_LIMIT_IP_SOURCE.value(),
          log,
          now: () => Date.now(),
        },
      );
    } catch (e) {
      if (e instanceof Rejected) throw new HttpsError(e.code, 'Request rejected.');
      log({ status: 'error', reason: 'unhandled' });
      throw new HttpsError('internal', 'Internal error.');
    }
  },
);
