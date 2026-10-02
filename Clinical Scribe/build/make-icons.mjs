// Draws every PNG icon and launch image from web/public/favicon.svg with a headless
// browser, so the brand mark has one source. The results are kept in the repository.
// Run from the tool folder after `npm install` in tests/:  node build/make-icons.mjs
//
//   web/public/icon-180|192|512.png             website and Home Screen icons
//   web/public-app/icon-maskable-512.png         app icon that phones may crop to a circle
//   web/public-app/launch/launch-<w>x<h>.png     iPhone and iPad launch images
//   android/app/src/main/res/mipmap-*/…          icons for Android 7 (newer Android
//                                                draws the vector icons in drawable/)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { LAUNCH_SCREENS, launchFile } from "../web/launch-screens.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../tests/package.json"));
const { chromium } = require("@playwright/test");

const BACKGROUND = "#f4f7fc";
const ANDROID_SIZES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

const favicon = readFileSync(resolve(here, "../web/public/favicon.svg"), "utf8");
const defs = favicon.match(/<defs>[\s\S]*<\/defs>/)[0];
const wave = favicon.match(/<g [\s\S]*<\/g>/)[0];
const tile = favicon.match(/<rect [^>]*\/>/)[0];

function svg(size, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">${defs}${body}</svg>`;
}

function shrink(scale, body) {
  return `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${body}</g>`;
}

const drawings = {
  // The full icon on white, as a phone shows it on the Home Screen.
  plain: (size) => svg(size, tile + wave),
  // Edge to edge, with the waveform well inside the circle phones may cut out.
  maskable: (size) => svg(size, `<rect width="64" height="64" fill="url(#g)"/>${shrink(0.72, wave)}`),
  // Android 7 icons: a rounded square and a circle, with the usual small margin.
  square: (size) => svg(size, shrink(0.9, tile + wave)),
  round: (size) => svg(size, `<circle cx="32" cy="32" r="29" fill="url(#g)"/>${shrink(0.82, wave)}`),
};

function save(path, png) {
  const target = resolve(here, "..", path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, png);
  console.log(path);
}

const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath });

async function drawIcon(page, markup, size, { background = null } = {}) {
  await page.setViewportSize({ width: size, height: size });
  const fill = background ? `background:${background}` : "background:transparent";
  await page.setContent(`<html><body style="margin:0;${fill}">${markup}</body></html>`);
  return page.screenshot({ clip: { x: 0, y: 0, width: size, height: size }, omitBackground: !background });
}

const iconPage = await browser.newPage();
for (const size of [180, 192, 512]) {
  save(`web/public/icon-${size}.png`, await drawIcon(iconPage, drawings.plain(size), size, { background: "#ffffff" }));
}
save("web/public-app/icon-maskable-512.png", await drawIcon(iconPage, drawings.maskable(512), 512));
for (const [density, size] of Object.entries(ANDROID_SIZES)) {
  save(`android/app/src/main/res/mipmap-${density}/ic_launcher.png`, await drawIcon(iconPage, drawings.square(size), size));
  save(`android/app/src/main/res/mipmap-${density}/ic_launcher_round.png`, await drawIcon(iconPage, drawings.round(size), size));
}
await iconPage.close();

// Launch images: the icon in the middle of the app background, one per screen size.
for (const ratio of [...new Set(LAUNCH_SCREENS.map((screen) => screen[2]))]) {
  const context = await browser.newContext({ deviceScaleFactor: ratio });
  const page = await context.newPage();
  for (const screen of LAUNCH_SCREENS.filter((item) => item[2] === ratio)) {
    const [width, height] = screen;
    await page.setViewportSize({ width, height });
    await page.setContent(
      `<html><body style="margin:0;height:100vh;display:grid;place-items:center;background:${BACKGROUND}">` +
        `<div style="width:96px;height:96px;filter:drop-shadow(0 10px 24px rgba(23,71,176,0.22))">${drawings.plain(96)}</div>` +
        "</body></html>",
    );
    save(`web/public-app/${launchFile(screen)}`, await page.screenshot({ clip: { x: 0, y: 0, width, height } }));
  }
  await context.close();
}

await browser.close();
