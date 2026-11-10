// Renders the PNG app icons from the logo drawing (public/icon.svg).
//
//   node scripts/render-icons.mjs
//
// Writes public/zephyrly-logo.png (the web-app icon and notification icon)
// and public/apple-touch-icon.png. Both are full-bleed squares with no
// rounded corners of their own: iOS, Android and the browser each cut an
// icon to their own shape, and a pre-rounded one shows a pale rim. The Z
// sits inside the middle 60%, well within the "maskable" safe zone.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(resolve(root, "public/icon.svg"), "utf8")
  // Square corners for the app icons; the favicon keeps its rounding.
  .replace('rx="24"', 'rx="0"');

const browser = await chromium.launch();
for (const [file, size] of [["zephyrly-logo.png", 512], ["apple-touch-icon.png", 180]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
  );
  await page.screenshot({ path: resolve(root, "public", file), omitBackground: false });
  await page.close();
  console.log(`wrote public/${file} (${size}×${size})`);
}
await browser.close();
