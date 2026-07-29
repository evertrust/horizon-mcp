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
    include: ['tests/llm-evaluation/**/*.test.ts'],
    testTimeout: 180_000,
  },
});
