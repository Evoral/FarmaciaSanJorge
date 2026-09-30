import { defineConfig } from "vitest/config";
import path from "node:path";

// `import "server-only"` (modules/*/infrastructure/*.server.ts) is resolved
// by Next's own bundler, not by an npm package -- give Vitest the same
// empty module Next compiles it to on the server.
const serverOnlyAlias = { "server-only": path.resolve(__dirname, "node_modules/next/dist/compiled/server-only/empty.js") };

// Two projects, run independently:
// - `unit`: fast, no I/O, safe to run always (npm test / CI unit job).
// - `db`: hits the ONE real Supabase database, every test inside a
//   rolled-back transaction. Sequential, long timeouts, opt-in via
//   FSJ_DB_TESTS=yes (SKIPPED otherwise) -- see tests/db/global-setup.ts.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      ...serverOnlyAlias,
    },
  },
  test: {
    projects: [
      {
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "."),
            ...serverOnlyAlias,
          },
        },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts", "shared/**/*.test.ts", "modules/**/*.test.ts"],
          exclude: ["tests/db/**", "node_modules/**"],
        },
      },
      {
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "."),
            ...serverOnlyAlias,
          },
        },
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts"],
          globalSetup: ["tests/db/global-setup.ts"],
          // Closes the per-role connections cached in tests/db/helpers.ts.
          setupFiles: ["tests/db/setup.ts"],
          // DB tests share one database and mutate role/session state
          // (set_config, role grants) -- running them in parallel would
          // be flaky by construction, so force one file at a time.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
