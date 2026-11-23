// Serves the demo pages locally: npm run demo, then open the printed address.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from './static-server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 8080);
const { origin } = await serveStatic({ '/': join(root, 'demo') }, port);
console.log(`Demo pages: ${origin}/`);
