# ScamFuse

**A browser extension that pauses the dangerous actions scammers push people into, and asks someone they trust.**

Scams end with one of a few irreversible steps: installing a remote access program, pasting a
command into Windows, calling a "support" number from a fake virus alert, installing a "free coins"
cheat. ScamFuse watches for those steps, stops them before they happen and shows a calm pause
screen with one big button: **Ask Dad** (or whoever you set up). The button opens WhatsApp,
Telegram or e-mail with a ready message. Nothing is sent by itself.

With Telegram linked, the alert reaches the trusted person by itself. They press **Allow** or
**Don't allow** on their phone, or reply with a few words, and the answer appears on the pause
screen. They can also read out a one-time code by phone to unlock the action.

It is made for parents and grandparents, for children and teenagers, and for yourself.

[Try the demo](https://scamfuse-demo.dev-interactive-rm.workers.dev/) · [Privacy](docs/PRIVACY.md) · [Limits](docs/THREAT-MODEL.md) · [Translate](docs/TRANSLATING.md)

## What it stops

| Trick | What ScamFuse does | Profiles |
| --- | --- | --- |
| A "bank employee" asks to install AnyDesk, TeamViewer and similar | Pauses the download and the program's site | All |
| A fake "I am not a robot" check slips a command into the clipboard ("ClickFix") | Replaces the command with a harmless line and pauses the page | All |
| A page pretends the computer is infected and shows a "support" number | Leaves the page, mutes it and pauses | All |
| A fake login or payment page: look-alike address (`paypa1.com`, Cyrillic letters, `paypal.com.verify.top`), a copied brand page, a password sent to a Telegram bot, a wallet recovery phrase request | Stops a clear fake at once; on a suspicious page, pauses before the password is typed; the toolbar window shows the page check | All |
| A "support specialist" asks to share the screen on an unknown site | Refuses the request and pauses; meeting services are not affected | All |
| Cheats, mods and cracked games from unofficial sites | Pauses the download | Child |
| Bank card details typed on a site | Pauses before the purchase | Child |

Each check can be switched off in the settings. Official stores (Steam, Epic Games, Roblox,
Microsoft, Apple, Google and others) are never stopped.

## Two clicks to set up

1. Choose who is protected: a parent, a child, or yourself.
2. Write who to ask and their phone number, press **Turn on protection**.

The language follows the browser (English and Russian today) and can be switched on any screen.
An optional PIN turns on the strict mode: a stopped action then waits for the PIN or for 30 minutes.
Linking Telegram is one more step on the same screen: the trusted person scans a QR code with
their phone.

## Alerts in Telegram

| What the trusted person gets | When |
| --- | --- |
| An alert with **Allow**, **Don't allow**, **Always allow this site** and a one-time unlock code | A dangerous action is stopped (any action in the strict mode, or when "Ask" is pressed) |
| A notice | The extension is removed, protection is switched off, the PIN is entered wrong five times, or the computer is silent for 7 days |

The relay behind the bot is a small Cloudflare Worker on the free plan: [relay/](relay/README.md).
Without it, ScamFuse works the same and the "Ask" button opens WhatsApp, Telegram or e-mail with a
ready message.

## Install

ScamFuse is not in the Chrome Web Store yet. To try it now:

1. Download `scamfuse-<version>.zip` from the latest [CI run](../../actions/workflows/ci.yml)
   (section Artifacts, needs a GitHub account) or build it yourself (below), and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode**, press **Load unpacked** and choose the unzipped folder.
3. The setup page opens by itself.

Built and tested in Chrome on desktop. Edge, Brave, Opera and Vivaldi use the same engine and
should work, but are not tested yet. Mobile browsers do not run extensions.

## Privacy in one paragraph

All checks run on the computer, with no analytics and no remote code. It keeps a local log of
what it stopped (time, kind, site name), visible in the settings. When Telegram is linked, an
alert sends only the kind of action, the site name and the time to the relay, which passes it to
the trusted person and deletes it after 30 days. Details: [docs/PRIVACY.md](docs/PRIVACY.md).

## Development

Requires Node.js 22.18 or newer.

```bash
npm ci
npm run check      # type check, unit tests, build into dist/
npm run test:e2e   # Chromium with the extension walks through the demo scenarios
npm run demo       # serves the demo pages at http://127.0.0.1:8080/
npm run package    # release/scamfuse-<version>.zip
node scripts/relay-local.mjs   # a relay on this computer with a simulated Telegram
```

| Folder | What is inside |
| --- | --- |
| `extension/src/core` | Rules and scoring: pure TypeScript, covered by unit tests |
| `extension/src/background` | Service worker: pauses actions, carries out decisions |
| `extension/src/injected` | Hooks in the page's own context (clipboard, full screen, dialogs) |
| `extension/src/content` | Isolated script that scores what the hooks report |
| `extension/src/pages` | Pause screen, setup, settings, toolbar window |
| `extension/src/rules` | Lists of remote access tools, sites and scam phrases (JSON) |
| `relay` | Alert relay for Telegram: Cloudflare Worker and D1 database |
| `extension/public/_locales` | Translations |
| `demo` | Safe imitations of the scams, published with GitHub Pages |
| `tests` | Unit tests (`node:test`) and browser tests (Playwright) |

The build is bundled but not minified, so the code in the store package is readable.

## Roadmap

- **0.2** (this version) — Telegram alerts with answers, unlock codes, removal and silence notices,
  screen sharing and card entry checks, reading the pause screen aloud. Next: Chrome Web Store.
- **0.3** — Look-alike bank and game sites, "free game currency" pages, gift card scams,
  rule updates without a new release, Firefox, ten more languages.

## License

[MIT](LICENSE)
