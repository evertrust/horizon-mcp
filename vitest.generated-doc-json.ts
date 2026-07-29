import { dirname, resolve } from 'node:path';

const GENERATED_DOC_JSON_PREFIX = '\0generated-doc-json-runtime:';

/** Load generated documentation JSON at runtime instead of expanding it in Vite. */
export function generatedDocJsonRuntimePlugin() {
  return {
    name: 'generated-doc-json-runtime',
    enforce: 'pre' as const,
    resolveId(source: string, importer?: string) {
      if (!importer || !source.endsWith('.json')) return;
      const importerPath = importer.split('?', 1)[0] ?? importer;
      const filePath = resolve(dirname(importerPath), source);
      if (!/\/src\/generated\/docs\/[^/]+\.json$/.test(filePath)) return;
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
  };
}
