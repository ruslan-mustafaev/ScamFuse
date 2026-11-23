// Renders the toolbar icons from one SVG with the browser that Playwright ships.
// Run once after changing the design: npm run icons

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'extension/public/icons');
await mkdir(out, { recursive: true });

// A shield with a pause sign: "stop and check".
function svg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <path d="M64 6 L114 24 V62 C114 92 92 113 64 122 C36 113 14 92 14 62 V24 Z" fill="${color}"/>
  <rect x="44" y="40" width="14" height="46" rx="5" fill="#ffffff"/>
  <rect x="70" y="40" width="14" height="46" rx="5" fill="#ffffff"/>
</svg>`;
}

const variants = { on: '#0b4f9c', off: '#667085' };
const sizes = [16, 32, 48, 128];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, color] of Object.entries(variants)) {
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent"><img style="display:block;width:${size}px;height:${size}px" src="data:image/svg+xml;base64,${Buffer.from(svg(color)).toString('base64')}"></body></html>`,
    );
    await page.screenshot({ path: join(out, `${name}-${size}.png`), omitBackground: true });
  }
}
await browser.close();
console.log('Icons written to extension/public/icons');
