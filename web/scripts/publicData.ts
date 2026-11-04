// Builds the copy of the dataset that is published with the static site.
// Passport and ID card numbers are masked here, before anything leaves the machine, so the
// browser never receives them, not even in the downloaded JSON.
import type { Dataset } from '../../src/data/types.js';
import { maskDocumentNumber } from '../../src/lib/domain.js';

export function toPublicDataset(data: Dataset): Dataset {
  return {
    ...data,
    passengers: data.passengers.map((p) => ({
      ...p,
      passport: { ...p.passport, number: maskDocumentNumber(p.passport.number) },
      idCard: p.idCard ? { ...p.idCard, number: maskDocumentNumber(p.idCard.number)! } : null,
    })),
  };
}

/** Throws if any raw passport or ID card number from `original` appears anywhere in `json`. */
export function assertNoRawDocumentNumbers(original: Dataset, json: string): void {
  const numbers = original.passengers.flatMap((p) => [p.passport.number, p.idCard?.number ?? null]);
  const leaked = numbers.filter((n): n is string => n !== null && json.includes(n));
  if (leaked.length > 0) {
    throw new Error(`Refusing to publish: ${leaked.length} raw passport or ID card number(s) found in the public dataset.`);
  }
}
