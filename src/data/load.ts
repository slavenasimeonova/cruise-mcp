// Node-only: reads data/cruise.json from disk.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type CruiseStore, storeFromJson } from './store.js';

/** Resolves to <project>/data/cruise.json from both src/data (tsx, tests) and dist/data (built). */
export const DEFAULT_DATA_FILE = fileURLToPath(new URL('../../data/cruise.json', import.meta.url));

export function loadStore(file = DEFAULT_DATA_FILE): CruiseStore {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read cruise data at ${file}. Run "npm run seed" to generate it. (${(err as Error).message})`);
  }
  return storeFromJson(JSON.parse(raw), file);
}
