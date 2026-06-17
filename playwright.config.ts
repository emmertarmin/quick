import { defineConfig, devices } from "@playwright/test";

const quickDomain = process.env.QUICK_DOMAIN?.trim() || "local.example.com";
const quickScheme = process.env.QUICK_SCHEME?.trim() || "https";
const platformOrigin = process.env.QUICK_E2E_PLATFORM_ORIGIN?.trim() || `${quickScheme}://${quickDomain}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "docker compose up -d --wait",
    url: `${platformOrigin}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
    ignoreHTTPSErrors: true,
  },
});
