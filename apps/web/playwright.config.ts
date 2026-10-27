import { defineConfig, devices } from "@playwright/test";

const localChrome = process.env.GEL_CHROME_PATH;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.GEL_BASE_URL ?? "http://127.0.0.1:3000",
    headless: true,
    launchOptions: localChrome ? { executablePath: localChrome } : {},
    acceptDownloads: true,
  },
  webServer: process.env.GEL_BASE_URL ? undefined : {
    command: "npm run dev -- --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000/workspace",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
