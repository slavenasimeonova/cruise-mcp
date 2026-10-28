// Protocol-level tests: a real MCP client talking to the server, in-process and over stdio.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectClient, NEXT_SAILING, textOf } from './helpers.js';

const TOOL_NAMES = [
  'excursion_availability',
  'find_issues',
  'find_unconfirmed_excursions',
  'get_booking',
  'list_sailings',
  'passenger_summary',
];

describe('MCP server (in-memory transport)', () => {
  let client: Client;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ client, close } = await connectClient());
  });
  afterAll(async () => {
    await close();
  });

  it('exposes exactly the six read-only tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOL_NAMES);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
      expect(tool.description).toBeTruthy();
      expect(tool.outputSchema).toBeDefined();
    }
  });

  it('advertises input patterns in the JSON schema', async () => {
    const { tools } = await client.listTools();
    const getBooking = tools.find((t) => t.name === 'get_booking')!;
    expect(getBooking.inputSchema.required).toEqual(['booking_id']);
    expect(JSON.stringify(getBooking.inputSchema)).toContain('BK-');
  });

  const validCalls: Record<string, Record<string, unknown>> = {
    list_sailings: { ship: 'Sea Lyra' },
    get_booking: { booking_id: 'BK-100001' },
    find_unconfirmed_excursions: { sailing_id: NEXT_SAILING.id },
    excursion_availability: { sailing_id: NEXT_SAILING.id, port: 'Naples' },
    passenger_summary: { sailing_id: NEXT_SAILING.id },
    find_issues: { sailing_id: NEXT_SAILING.id },
  };

  for (const [name, args] of Object.entries(validCalls)) {
    it(`${name}: returns structured content plus the same data as text`, async () => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toBeDefined();
      expect(JSON.parse(textOf(result))).toEqual(result.structuredContent);
      expect((result.structuredContent as { summary: string }).summary).toBeTruthy();
    });
  }

  const invalidCalls: [string, Record<string, unknown>, RegExp][] = [
    ['list_sailings', { from_date: '01/11/2026' }, /from_date/],
    ['get_booking', { booking_id: '12345' }, /BK-100001/],
    ['get_booking', {}, /booking_id/],
    ['find_unconfirmed_excursions', { sailing_id: 'cruise-1' }, /AH-CV-261107/],
    ['excursion_availability', { sailing_id: NEXT_SAILING.id }, /port/],
    ['passenger_summary', { sailing_id: 42 }, /sailing_id/],
    ['find_issues', { sailing_id: 'AH-CV-26110' }, /AH-CV-261107/],
    ['find_unconfirmed_excursions', { sailing_id: NEXT_SAILING.id, port: '' }, /port/],
  ];

  for (const [name, args, message] of invalidCalls) {
    it(`${name}: rejects invalid input ${JSON.stringify(args)}`, async () => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(message);
    });
  }

  it('turns lookup failures into readable tool errors', async () => {
    const result = await client.callTool({ name: 'find_issues', arguments: { sailing_id: 'AH-CV-300101' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Sailing "AH-CV-300101" was not found\. Call list_sailings/);
    expect(result.structuredContent).toBeUndefined();
  });

  it('reports port mismatches with the valid ports', async () => {
    const result = await client.callTool({ name: 'excursion_availability', arguments: { sailing_id: NEXT_SAILING.id, port: 'Atlantis' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Its ports of call are: Marseille, La Spezia/);
  });
});

describe('MCP server (stdio, separate process)', () => {
  it('starts with serveStdio and answers a tool call', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/index.ts'],
      cwd: root,
      stderr: 'pipe',
    });
    const client = new Client({ name: 'stdio-test', version: '1.0.0' });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(6);
      const result = await client.callTool({ name: 'list_sailings', arguments: { ship: 'NP' } });
      expect(result.isError).toBeFalsy();
      expect((result.structuredContent as { count: number }).count).toBe(6);
    } finally {
      await client.close();
    }
  });
});
