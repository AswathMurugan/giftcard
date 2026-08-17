import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    // node environment — the starter does NOT include @testing-library/react
    // or jsdom. Tests must cover pure logic (helpers, formatters, query
    // builders, validators), not React component rendering.
    environment: 'node',
    reporters: ['default'],
    outputFile: {
      json: './test-results/results.json',
    },
    // Allow any tag name. CLAUDE.md tells the agent to use both the
    // 6 standard tags (important/smoke/logic/edge-case/slow/error-boundary)
    // AND feature-specific ones (client-list, weather, etc.). Strict tag
    // enforcement would reject the feature tags.
    strictTags: false,
  },
});
