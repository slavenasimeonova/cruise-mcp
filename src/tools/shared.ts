import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { CruiseStore } from '../data/store.js';
import type { Sailing } from '../data/types.js';
import { daysToDeparture, requireShip } from '../lib/domain.js';
import { ToolInputError } from '../lib/errors.js';

// ---------------------------------------------------------------------------
// Input schemas shared by several tools
// ---------------------------------------------------------------------------

export const sailingIdInput = z
  .string()
  .regex(/^AH-[A-Z]{2}-\d{6}$/, 'Sailing IDs look like AH-CV-261107 (ship code + departure date YYMMDD)')
  .describe('Sailing ID, e.g. "AH-CV-261107". Use list_sailings to find one.');

export const portInput = z
  .string()
  .min(2)
  .max(60)
  .describe('Port of call, e.g. "Cozumel", "Santorini" or "Rome". Case and accents are ignored.');

// ---------------------------------------------------------------------------
// Output building blocks
// ---------------------------------------------------------------------------

export const sailingRefOutput = z.object({
  sailingId: z.string(),
  ship: z.string(),
  region: z.string(),
  name: z.string(),
  departureDate: z.string(),
  returnDate: z.string(),
  daysToDeparture: z.number().int(),
});

export function sailingRef(store: CruiseStore, sailing: Sailing): z.output<typeof sailingRefOutput> {
  return {
    sailingId: sailing.id,
    ship: requireShip(store, sailing).name,
    region: sailing.region,
    name: sailing.name,
    departureDate: sailing.departureDate,
    returnDate: sailing.returnDate,
    daysToDeparture: daysToDeparture(store, sailing),
  };
}

// ---------------------------------------------------------------------------
// Tool definition and registration
// ---------------------------------------------------------------------------

export interface ToolDefinition<I extends z.ZodObject, O extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  /** Pure query over the store. Throws ToolInputError for bad input the schema can't catch. */
  run(store: CruiseStore, input: z.output<I>): z.output<O>;
}

export function defineTool<I extends z.ZodObject, O extends z.ZodObject>(def: ToolDefinition<I, O>): ToolDefinition<I, O> {
  return def;
}

/** Every tool here only reads a local, fixed dataset. */
export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function toolResult(def: ToolDefinition<z.ZodObject, z.ZodObject>, store: CruiseStore, input: unknown): CallToolResult {
  try {
    const output = def.run(store, input as z.output<z.ZodObject>);
    return {
      content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
    };
  } catch (err) {
    if (err instanceof ToolInputError) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
    throw err;
  }
}

export function registerTool(server: McpServer, store: CruiseStore, def: ToolDefinition<z.ZodObject, z.ZodObject>): void {
  server.registerTool(
    def.name,
    {
      title: def.title,
      description: def.description,
      inputSchema: def.inputSchema,
      outputSchema: def.outputSchema,
      annotations: { title: def.title, ...READ_ONLY_ANNOTATIONS },
    },
    async (args) => toolResult(def, store, args),
  );
}
