import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKb } from '../../src/kb.js';
import { compileFilters } from '../../src/output.js';

export const FUNCTIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ASK_ROOT = join(FUNCTIONS_DIR, '..');
export const kb = loadKb();
if (!kb) throw new Error('generated/kb.json missing or invalid: run `npm run build-kb` first');
export const filters = compileFilters(kb);

/** A model result as parseGenerateContent returns it. */
export function modelResult(obj, finishReason = 'STOP') {
  return {
    text: typeof obj === 'string' ? obj : JSON.stringify(obj),
    finishReason,
    usage: { promptTokens: 10500, cachedTokens: 0, outputTokens: 120, thoughtTokens: 0 },
  };
}
