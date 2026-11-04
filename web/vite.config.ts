import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const webRoot = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root: webRoot,
  // Relative asset URLs + hash routing: works under /cruise-mcp/ on GitHub Pages or any other path.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    // The dashboard imports the MCP server's query code from ../src.
    fs: { allow: [repoRoot] },
  },
});
