import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

import { generatedDocJsonRuntimePlugin } from './vitest.generated-doc-json.js';

export default defineConfig({
  plugins: [
    generatedDocJsonRuntimePlugin(),
    {
      name: 'md-raw',
      transform(_code: string, id: string) {
        if (id.endsWith('.md')) {
          const content = readFileSync(id, 'utf-8');
          return { code: `export default ${JSON.stringify(content)};` };
        }
      },
    },
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'tests/llm-evaluation/**', 'tests/llm-live/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/resources/knowledge/**'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
