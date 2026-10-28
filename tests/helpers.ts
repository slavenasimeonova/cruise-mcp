import { Client, InMemoryTransport, type CallToolResult } from '@modelcontextprotocol/client';
import { loadStore } from '../src/data/store.js';
import { createServer } from '../src/server.js';

export const store = loadStore();

/** Connects a real MCP client to the server in-process (no network, no child process). */
export async function connectClient(): Promise<{ client: Client; close: () => Promise<void> }> {
  // Both halves must come from the same package's InMemoryTransport.
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(store);
  const client = new Client({ name: 'cruise-mcp-tests', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export function textOf(result: CallToolResult): string {
  return result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
}

/** First sailing in the schedule; departs 3 days after the dataset's as-of date. */
export const NEXT_SAILING = store.sailings[0]!;
