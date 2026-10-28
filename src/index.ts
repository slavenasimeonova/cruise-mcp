#!/usr/bin/env node
// stdio entry point. stdout carries MCP messages only; all logging goes to stderr.
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadStore } from './data/store.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server.js';

try {
  const store = loadStore();
  serveStdio(() => createServer(store), {
    onerror: (err) => console.error(`[${SERVER_NAME}]`, err),
  });
  console.error(`[${SERVER_NAME}] v${SERVER_VERSION} ready on stdio (data as of ${store.asOf})`);
} catch (err) {
  console.error(`[${SERVER_NAME}] failed to start: ${(err as Error).message}`);
  process.exit(1);
}
