import { defineConfig, devices } from "@playwright/test";

// FASE 0: config only -- no E2E tests are written yet (see README: E2E
// tests will be added at the end of the project). `@playwright/test` is
// installed and this config typechecks, but browsers are NOT downloaded
// and `npm run test:e2e` is not run as part of FASE 0 verification.
// `tests/e2e/` intentionally has no `*.spec.ts` files (just `.gitkeep`).
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
