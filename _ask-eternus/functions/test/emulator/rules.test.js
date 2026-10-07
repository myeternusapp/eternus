// Firestore emulator only (demo- project). Client SDK access must be denied everywhere.
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..', '..');
let env;

before(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-ask-eternus',
    firestore: { rules: readFileSync(join(ROOT, 'firestore.rules'), 'utf8'), host, port: Number(port) },
  });
});
after(() => env?.cleanup());

test('anonymous and signed-in clients can neither read nor write anything', async () => {
  for (const ctx of [env.unauthenticatedContext(), env.authenticatedContext('someone')]) {
    const db = ctx.firestore();
    await assertFails(db.doc('config/askEternus').get());
    await assertFails(db.doc('config/askEternus').set({ enabled: true }));
    await assertFails(db.doc('askRateLimits/g_d20261006').get());
    await assertFails(db.doc('askRateLimits/g_d20261006').set({ count: 0 }));
    await assertFails(db.collection('askRateLimits').get());
    await assertFails(db.doc('anything/else').set({ x: 1 }));
  }
});
