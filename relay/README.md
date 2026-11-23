# ScamFuse alert relay

A small Cloudflare Worker with a D1 database. It passes alerts from the extension to the trusted
person's Telegram and their decision back. It runs on Cloudflare's free plan
(100,000 requests a day), so hosting costs nothing.

What it stores is listed in [migrations/0001_init.sql](migrations/0001_init.sql): installs (with
hashed secrets), linked Telegram chats, pairing codes for 10 minutes, and alerts (kind, site name,
time, decision) for 30 days. No browsing history, no page content.

## Deploy once

1. **Telegram bot.** In Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`, choose a
   name and a username ending in `bot`. Keep the token it gives you. Put the username (without `@`)
   into `BOT_USERNAME` in [wrangler.toml](wrangler.toml).
2. **Database.** In the Cloudflare dashboard: Storage & Databases → D1 → Create database, name it
   `scamfuse`. Copy its Database ID into `database_id` in [wrangler.toml](wrangler.toml).
3. **API token.** Cloudflare dashboard → My Profile → API Tokens → Create Token → template
   "Edit Cloudflare Workers", and add the permission Account → D1 → Edit. Also copy your Account ID
   from the Workers & Pages overview.
4. **GitHub secrets.** Repository → Settings → Secrets and variables → Actions → New repository secret:
   - `CLOUDFLARE_API_TOKEN` — the token from step 3
   - `CLOUDFLARE_ACCOUNT_ID` — the account ID
   - `TELEGRAM_BOT_TOKEN` — the token from step 1
   - `TELEGRAM_WEBHOOK_SECRET` — any random string of 32+ letters and digits
5. **Deploy.** Actions → "Deploy relay" → Run workflow. It applies the database migrations and
   publishes the Worker at `https://scamfuse-relay.<your-subdomain>.workers.dev`.
6. **Connect Telegram.** Open `https://scamfuse-relay.<your-subdomain>.workers.dev/setup?key=<TELEGRAM_WEBHOOK_SECRET>`
   once in a browser. It answers `{"ok":true,...}` when Telegram accepted the webhook.
7. **Point the extension at it.** Set `DEFAULT_RELAY_URL` in
   [extension/src/core/config.ts](../extension/src/core/config.ts) to the Worker address. People who
   run their own relay can enter its address in the extension settings instead.

## API

All `/v1/` calls except registration carry `Authorization: Bearer <installId>:<secret>`.

| Call | What it does |
| --- | --- |
| `POST /v1/installs` | Registers an install: `installId`, `secret`, `uninstallToken`, `name`, `profile`, `language`, `timeZone` |
| `GET / PATCH / DELETE /v1/installs/me` | Linked people; rename; unlink and forget |
| `POST /v1/pairings`, `GET /v1/pairings/{code}` | 8-digit pairing code for the bot, and its status |
| `POST /v1/alerts`, `GET /v1/alerts/{id}` | Sends an alert with buttons; reads the decision and the reply |
| `POST /v1/test` | Test alert |
| `POST /v1/events` | `disabled` or `pin-locked` notice |
| `POST /v1/heartbeat` | Daily "still here" |
| `GET /u?i=&t=` | Opened by the browser when the extension is removed |
| `POST /telegram/webhook` | Telegram updates, checked with the secret header |
| `GET /setup?key=` | Registers the webhook and the bot commands |

## Develop

Tests run the same SQL on Node's built-in SQLite: `npm test` in the repository root.
`node scripts/relay-local.mjs` starts a local relay with a fake Telegram for the browser tests.
