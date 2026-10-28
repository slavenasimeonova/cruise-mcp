import { McpServer } from '@modelcontextprotocol/server';
import type * as z from 'zod/v4';
import type { CruiseStore } from './data/store.js';
import { excursionAvailability } from './tools/excursionAvailability.js';
import { findIssues } from './tools/findIssues.js';
import { findUnconfirmedExcursions } from './tools/findUnconfirmedExcursions.js';
import { getBooking } from './tools/getBooking.js';
import { listSailings } from './tools/listSailings.js';
import { passengerSummary } from './tools/passengerSummary.js';
import { registerTool, type ToolDefinition } from './tools/shared.js';

export const SERVER_NAME = 'azure-horizon-cruises';
export const SERVER_VERSION = '0.1.0';

export const TOOLS: readonly ToolDefinition<z.ZodObject, z.ZodObject>[] = [
  listSailings,
  getBooking,
  findUnconfirmedExcursions,
  excursionAvailability,
  passengerSummary,
  findIssues,
];

export function createServer(store: CruiseStore): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, title: 'Azure Horizon Cruises Operations (demo)', version: SERVER_VERSION },
    {
      instructions:
        'Read-only operations data for Azure Horizon Cruises, a fictional cruise line. ' +
        `All dates are relative to the dataset's "as of" date (${store.asOf}), not today. ` +
        'Start with list_sailings to find a sailing ID, then use passenger_summary, find_issues, ' +
        'excursion_availability or find_unconfirmed_excursions on it. get_booking looks up one booking (BK-xxxxxx).',
    },
  );
  for (const tool of TOOLS) registerTool(server, store, tool);
  return server;
}
