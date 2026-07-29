import { defineConfig } from 'vitest/config';

import { generatedDocJsonRuntimePlugin } from './vitest.generated-doc-json.js';

export default defineConfig({
  plugins: [generatedDocJsonRuntimePlugin()],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/llm-live/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
