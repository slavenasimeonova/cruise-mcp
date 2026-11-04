// The six tools, free of any MCP SDK runtime import so the web dashboard can bundle them too.
import type * as z from 'zod/v4';
import { excursionAvailability } from './excursionAvailability.js';
import { findIssues } from './findIssues.js';
import { findUnconfirmedExcursions } from './findUnconfirmedExcursions.js';
import { getBooking } from './getBooking.js';
import { listSailings } from './listSailings.js';
import { passengerSummary } from './passengerSummary.js';
import type { ToolDefinition } from './shared.js';

export const TOOLS: readonly ToolDefinition<z.ZodObject, z.ZodObject>[] = [
  listSailings,
  getBooking,
  findUnconfirmedExcursions,
  excursionAvailability,
  passengerSummary,
  findIssues,
];
