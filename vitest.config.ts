import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    testTimeout: 30000,
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts"],

    // Every integration test shares ONE PostgreSQL database and truncates it
    // between tests, so two test files running at the same time delete each
    // other's fixtures mid-test.
    //
    // `fileParallelism: false` is the setting that actually prevents that.
    // An earlier version of this file set `poolOptions.threads.singleThread`,
    // which silently did nothing: Vitest 2 defaults to the `forks` pool, so the
    // `threads` options were never read. The symptom was that each test file
    // passed on its own and failed when run together.
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
