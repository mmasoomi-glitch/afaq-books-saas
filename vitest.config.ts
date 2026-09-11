import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    testTimeout: 30000,
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
});
