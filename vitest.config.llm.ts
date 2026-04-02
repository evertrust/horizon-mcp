import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/llm-evaluation/**/*.test.ts"],
    testTimeout: 180_000,
  },
});
