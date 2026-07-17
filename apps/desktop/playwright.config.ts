import { defineConfig } from "@playwright/test";

// E2E tests drive the real Tauri app through the WebView2 CDP endpoint, so
// no Playwright-managed browser is downloaded or launched. One worker only:
// the tests share a single app instance and dev server.
export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  workers: 1,
  reporter: [["list"]],
});
