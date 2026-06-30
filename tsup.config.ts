import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // Matches package.json engines.node (>=24.10).
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Inline knowledge markdown files as string constants.
  // Plain imports (import x from "./file.md") work with this loader.
  // Do NOT use ?raw suffix - that is a Vite convention, not supported here.
  loader: { '.md': 'text' },
});
