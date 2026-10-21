import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests for the console, the Alexa+ page and the break-in page.
 * One server for the whole run, in memory (a fresh house each run), in DEMO_MODE
 * so the four scenarios can be played. Tests run one at a time because they share
 * that house. Build the console first: npm run test:e2e does.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.E2E_PORT ?? 8798);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "../e2e-report" }]] : "list",
  outputDir: "../e2e-results",
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
  webServer: {
    command: "npm start",
    cwd: ROOT,
    url: `${BASE}/console`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      HOST: "127.0.0.1",
      PORT: String(PORT),
      HOMEPULSE_DATA_DIR: "memory",
      HOMEPULSE_TZ: "America/Los_Angeles",
      DEMO_MODE: "true",
      BREAK_IT: "true",
      CONSOLE_EXPOSE_TOKENS: "true",
      APPROVAL_TIMEOUT_MS: "30000",
      MODEL_PROVIDER: "offline",
    },
  },
});
