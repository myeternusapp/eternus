import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GENERATED = join(dirname(fileURLToPath(import.meta.url)), '..', 'generated', 'kb.json');

/**
 * Loads the packaged KB and verifies its content hash. Returns null when the file is missing,
 * unreadable or altered: the handler then answers `unavailable` instead of an ungrounded answer.
 */
export function loadKb(path = GENERATED) {
  let kb;
  try { kb = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  return verifyKb(kb) ? Object.freeze(index(kb)) : null;
}

export function verifyKb(kb) {
  if (!kb || typeof kb !== 'object' || !Array.isArray(kb.sections) || !kb.sections.length) return false;
  const { contentHash, ...payload } = kb;
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex') === contentHash;
}

function index(kb) {
  const titles = Object.fromEntries(kb.sections.map((s) => [s.id, s.title]));
  return { ...kb, ids: kb.sections.map((s) => s.id), titles };
}
