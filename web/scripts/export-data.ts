// Writes web/public/data/cruise.public.json (git-ignored) from data/cruise.json for the dashboard.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DATA_FILE } from '../../src/data/load.js';
import type { Dataset } from '../../src/data/types.js';
import { assertNoRawDocumentNumbers, toPublicDataset } from './publicData.js';

const outDir = fileURLToPath(new URL('../public/data/', import.meta.url));
const outFile = `${outDir}cruise.public.json`;

const original = JSON.parse(readFileSync(DEFAULT_DATA_FILE, 'utf8')) as Dataset;
const json = `${JSON.stringify(toPublicDataset(original))}\n`;
assertNoRawDocumentNumbers(original, json);

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, json, 'utf8');
console.log(`Wrote ${outFile} (${(json.length / 1024 / 1024).toFixed(1)} MB, passport and ID card numbers masked)`);
