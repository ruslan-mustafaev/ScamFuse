# ScamFuse

**A browser extension that pauses the dangerous actions scammers push people into, and asks someone they trust.**

Scams end with one of a few irreversible steps: installing a remote access program, pasting a
command into Windows, calling a "support" number from a fake virus alert, installing a "free coins"
cheat. ScamFuse watches for those steps, stops them before they happen and shows a calm pause
screen with one big button: **Ask Dad** (or whoever you set up). The button opens WhatsApp,
Telegram or e-mail with a ready message. Nothing is sent by itself.

It is made for parents and grandparents, for children and teenagers, and for yourself.

[Try the demo](https://ruslan-mustafaev.github.io/ScamFuse/) · [Privacy](docs/PRIVACY.md) · [Limits](docs/THREAT-MODEL.md) · [Translate](docs/TRANSLATING.md)

## What it stops

| Trick | What ScamFuse does | Profiles |
| --- | --- | --- |
| A "bank employee" asks to install AnyDesk, TeamViewer and similar | Pauses the download and the program's site | All |
| A fake "I am not a robot" check slips a command into the clipboard ("ClickFix") | Replaces the command with a harmless line and pauses the page | All |
| A page pretends the computer is infected and shows a "support" number | Leaves the page, mutes it and pauses | All |
| Cheats, mods and cracked games from unofficial sites | Pauses the download | Child |

Each check can be switched off in the settings. Official stores (Steam, Epic Games, Roblox,
Microsoft, Apple, Google and others) are never stopped.

## Two clicks to set up

1. Choose who is protected: a parent, a child, or yourself.
2. Write who to ask and their phone number, press **Turn on protection**.

The language follows the browser (English and Russian today) and can be switched on any screen.
An optional PIN turns on the strict mode: a stopped action then waits for the PIN or for 30 minutes.

## Install

ScamFuse is not in the Chrome Web Store yet. To try it now:

1. Download `scamfuse-<version>.zip` from the latest [CI run](../../actions/workflows/ci.yml)
   (section Artifacts, needs a GitHub account) or build it yourself (below), and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode**, press **Load unpacked** and choose the unzipped folder.
3. The setup page opens by itself.

Built and tested in Chrome on desktop. Edge, Brave, Opera and Vivaldi use the same engine and
should work, but are not tested yet. Mobile browsers do not run extensions.

## Privacy in one paragraph

All checks run on the computer. ScamFuse has no server in this version, no analytics and no
remote code. It keeps a local log of what it stopped (time, kind, site name), visible in the
settings. A message leaves the computer only when someone presses the button and sends it from
their own messenger. Details: [docs/PRIVACY.md](docs/PRIVACY.md).

## Development

Requires Node.js 22.18 or newer.

```bash
npm ci
npm run check      # type check, unit tests, build into dist/
npm run test:e2e   # Chromium with the extension walks through the demo scenarios
npm run demo       # serves the demo pages at http://127.0.0.1:8080/
npm run package    # release/scamfuse-<version>.zip
```

| Folder | What is inside |
| --- | --- |
| `extension/src/core` | Rules and scoring: pure TypeScript, covered by unit tests |
| `extension/src/background` | Service worker: pauses actions, carries out decisions |
| `extension/src/injected` | Hooks in the page's own context (clipboard, full screen, dialogs) |
| `extension/src/content` | Isolated script that scores what the hooks report |
| `extension/src/pages` | Pause screen, setup, settings, toolbar window |
| `extension/src/rules` | Lists of remote access tools, sites and scam phrases (JSON) |
| `extension/public/_locales` | Translations |
| `demo` | Safe imitations of the scams, published with GitHub Pages |
| `tests` | Unit tests (`node:test`) and browser tests (Playwright) |

The build is bundled but not minified, so the code in the store package is readable.

## Roadmap

- **0.2** — Telegram bot: alerts reach the trusted person automatically, and they can allow or
  block the action from their phone. Screen sharing and card number checks. Chrome Web Store.
- **0.3** — Look-alike bank and game sites, "free game currency" pages, gift card scams,
  rule updates without a new release, Firefox, ten more languages.

## License

[MIT](LICENSE)
