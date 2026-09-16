import { defineConfig } from "@playwright/test";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: "./vm-rust/tests/browser",
  timeout: 1_800_000,
  use: {
    headless: !!process.env.CI,
    baseURL: "http://127.0.0.1:9101",
    video: process.env.CI ? "on" : "off",
    // Always silence the client's audio during e2e runs.
    launchOptions: {
      args: ["--mute-audio"],
    },
  },
  webServer: {
    command: "node scripts/serve-browser-runner.mjs",
    port: 9101,
    cwd: __dirname,
    reuseExistingServer: true,
  },
});
