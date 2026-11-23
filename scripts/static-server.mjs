// Tiny static file server for the demo pages and the browser tests. No dependencies.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** Serves `mounts` ({ '/': dir, '/fixtures/': dir }) on 127.0.0.1. Resolves to { server, origin }. */
export function serveStatic(mounts, port = 0) {
  const entries = Object.entries(mounts).sort((a, b) => b[0].length - a[0].length);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const mount = entries.find(([prefix]) => url.pathname.startsWith(prefix));
      if (!mount) throw new Error('not found');
      const [prefix, dir] = mount;
      const base = resolve(dir);
      let path = resolve(base, normalize(decodeURIComponent(url.pathname.slice(prefix.length))));
      if (!path.startsWith(base)) throw new Error('outside');
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      const body = await readFile(path);
      response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('Not found');
    }
  });
  return new Promise((done) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      done({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}
