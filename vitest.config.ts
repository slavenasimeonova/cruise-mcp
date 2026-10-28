import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The stdio end-to-end test spawns a real Node process.
    testTimeout: 30_000,
  },
});
