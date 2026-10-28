// Writes data/cruise.json from the deterministic generator and prints a short summary.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateDataset, serializeDataset } from './generate.js';

const outFile = fileURLToPath(new URL('../data/cruise.json', import.meta.url));
mkdirSync(fileURLToPath(new URL('../data/', import.meta.url)), { recursive: true });

const dataset = generateDataset();
const json = serializeDataset(dataset);
writeFileSync(outFile, json, 'utf8');

const sha256 = createHash('sha256').update(json).digest('hex');
console.log(`Wrote ${outFile}`);
console.log(
  `  ${dataset.ships.length} ships, ${dataset.sailings.length} sailings, ${dataset.bookings.length} bookings, ` +
    `${dataset.passengers.length} passengers, ${dataset.excursions.length} excursions, ${dataset.excursionBookings.length} excursion bookings`,
);
console.log(`  as of ${dataset.meta.asOf}, sha256 ${sha256}`);
