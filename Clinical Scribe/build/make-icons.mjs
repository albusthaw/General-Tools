// Draws the PNG app icons from web/public/favicon.svg with a headless browser.
// Run from the tool folder after `npm install` in tests/:  node build/make-icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../tests/package.json"));
const { chromium } = require("@playwright/test");

const svg = readFileSync(resolve(here, "../web/public/favicon.svg"), "utf8");
const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();
for (const size of [180, 192, 512]) {
  await page.setViewportSize({ width: size, height: size });
  // The icon is drawn on a white square so it looks right as a phone home-screen icon.
  await page.setContent(`<html><body style="margin:0;background:#ffffff">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(resolve(here, `../web/public/icon-${size}.png`), png);
  console.log(`icon-${size}.png`);
}
await browser.close();
