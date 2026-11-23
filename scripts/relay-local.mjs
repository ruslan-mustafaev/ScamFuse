// Runs the relay on this computer with Node's SQLite and a fake Telegram.
// Used by the browser tests; also handy for trying the extension without Cloudflare:
//   node scripts/relay-local.mjs   → prints the address to put into the extension settings

import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { daily, handle } from '../relay/src/app.ts';
import { fakeTelegram } from '../relay/dev/fake-telegram.ts';
import { sqliteD1 } from '../relay/dev/sqlite-d1.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PASSED_HEADERS = ['authorization', 'content-type', 'x-telegram-bot-api-secret-token'];

export async function startLocalRelay({ port = 0, webhookSecret = 'local-webhook-secret' } = {}) {
  const telegram = fakeTelegram();
  let offset = 0;
  const deps = {
    db: sqliteD1(':memory:', [join(root, 'relay/migrations/0001_init.sql')]),
    telegram,
    botUsername: 'ScamFuseBot',
    webhookSecret,
    now: () => Date.now() + offset,
  };
  let origin = '';
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = {};
    for (const name of PASSED_HEADERS) if (req.headers[name]) headers[name] = String(req.headers[name]);
    const request = new Request(`${origin}${req.url}`, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
    });
    const response = await handle(request, deps);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((done) => server.listen(port, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;

  /** Sends a Telegram update to the relay as Telegram would. */
  async function telegramUpdate(update) {
    await fetch(`${origin}/telegram/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': webhookSecret },
      body: JSON.stringify(update),
    });
  }

  return {
    origin,
    telegram,
    telegramUpdate,
    advance: (ms) => {
      offset += ms;
    },
    daily: () => daily(deps),
    close: () => new Promise((done) => server.close(done)),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const relay = await startLocalRelay({ port: Number(process.env.PORT ?? 8787) });
  console.log(`Local relay: ${relay.origin}`);
  console.log('Telegram is simulated: messages are printed here.');
  const print = relay.telegram.sendMessage;
  relay.telegram.sendMessage = async (chatId, text, keyboard) => {
    console.log(`\n→ chat ${chatId}:\n${text}${keyboard ? `\n[${keyboard.flat().map((b) => b.text).join('] [')}]` : ''}`);
    return print(chatId, text, keyboard);
  };
}
