// Builds the copy of the dataset that is published with the static site.
// Passport numbers are masked here, before anything leaves the machine, so the
// browser never receives them, not even in the downloaded JSON.
import type { Dataset } from '../../src/data/types.js';
import { maskPassportNumber } from '../../src/lib/domain.js';

export function toPublicDataset(data: Dataset): Dataset {
  return {
    ...data,
    passengers: data.passengers.map((p) => ({
      ...p,
      passport: { ...p.passport, number: maskPassportNumber(p.passport.number) },
    })),
  };
}

/** Throws if any raw passport number from `original` appears anywhere in `json`. */
export function assertNoRawPassportNumbers(original: Dataset, json: string): void {
  const leaked = original.passengers.map((p) => p.passport.number).filter((n): n is string => n !== null && json.includes(n));
  if (leaked.length > 0) {
    throw new Error(`Refusing to publish: ${leaked.length} raw passport number(s) found in the public dataset.`);
  }
}
