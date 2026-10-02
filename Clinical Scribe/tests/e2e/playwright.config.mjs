import { existsSync, readdirSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Use the Chromium that is already installed when one is available.
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  const dir = readdirSync(root).find((name) => /^chromium-\d+$/.test(name));
  const candidate = dir ? `${root}/${dir}/chrome-linux/chrome` : null;
  return candidate && existsSync(candidate) ? candidate : undefined;
}

const launchOptions = {
  executablePath: chromiumPath(),
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
};

export default defineConfig({
  testDir: ".",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "./output",
  globalSetup: "./global-setup.mjs",
  use: {
    baseURL: "http://127.0.0.1:4173",
    launchOptions,
    permissions: ["microphone", "clipboard-read", "clipboard-write"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
    {
      name: "phone",
      use: { browserName: "chromium", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    // The website, and the app build at /app/ (allowed to reach this computer's server),
    // with the connect files a deploy adds.
    command: "npm run build:all && node ../tests/e2e/write-connect.mjs && npm run preview",
    env: { CS_LOCAL_APP: "1" },
    cwd: "../../web",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
