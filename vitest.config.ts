import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const GENERATED_DOC_JSON_PREFIX = '\0generated-doc-json-runtime:';

export default defineConfig({
  plugins: [
    {
      name: 'generated-doc-json-runtime',
      enforce: 'pre',
      resolveId(source: string, importer?: string) {
        if (!importer || !source.endsWith('.json')) return;
        const importerPath = importer.split('?', 1)[0] ?? importer;
        const filePath = resolve(dirname(importerPath), source);
        if (!/\/src\/generated\/docs\/[^/]+\.json$/.test(filePath)) {
          return;
        }
        return `${GENERATED_DOC_JSON_PREFIX}${encodeURIComponent(filePath)}.js`;
      },
      load(id: string) {
        if (!id.startsWith(GENERATED_DOC_JSON_PREFIX)) return;
        const filePath = decodeURIComponent(
          id.slice(GENERATED_DOC_JSON_PREFIX.length, -'.js'.length),
        );
        return {
          code:
            `import { readFileSync } from 'node:fs';\n` +
            `export default JSON.parse(readFileSync(${JSON.stringify(filePath)}, 'utf8'));`,
          map: null,
        };
      },
    },
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
