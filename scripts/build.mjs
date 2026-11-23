// Builds the extension into dist/. The code is bundled but not minified,
// so anyone (and the Chrome Web Store review) can read what it does.

import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'extension');
const out = join(root, 'dist');

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'pages'), { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: {
    background: 'extension/src/background/index.ts',
    'main-world': 'extension/src/injected/main-world.ts',
    bridge: 'extension/src/content/bridge.ts',
    'pages/pause': 'extension/src/pages/pause.ts',
    'pages/welcome': 'extension/src/pages/welcome.ts',
    'pages/options': 'extension/src/pages/options.ts',
    'pages/popup': 'extension/src/pages/popup.ts',
  },
  outdir: out,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: false,
  legalComments: 'none',
  charset: 'utf8',
  logLevel: 'warning',
});

await cp(join(src, 'public'), out, { recursive: true });
for (const page of ['pause', 'welcome', 'options', 'popup']) {
  await cp(join(src, 'src/pages', `${page}.html`), join(out, 'pages', `${page}.html`));
}
await cp(join(src, 'src/pages/pages.css'), join(out, 'pages/pages.css'));

const manifest = JSON.parse(await readFile(join(src, 'manifest.json'), 'utf8'));
manifest.version = pkg.version;
await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built ScamFuse ${pkg.version} into dist/`);
