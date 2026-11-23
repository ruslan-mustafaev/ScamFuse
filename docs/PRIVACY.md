# Privacy

ScamFuse runs on the computer where it is installed. Version 0.1 has no server.

## What stays on the computer

| Data | Where | How long |
| --- | --- | --- |
| Settings: profile, mode, who to ask, their phone or e-mail, language | `chrome.storage.local` | Until changed or the extension is removed |
| PIN | `chrome.storage.local`, only as a PBKDF2-SHA-256 hash with a random salt | Until changed |
| Log of stopped actions: time, kind, site name, result | `chrome.storage.local`, last 200 entries | Until cleared in the settings |
| Actions waiting for a decision, sites allowed for 30 minutes | `chrome.storage.session` | Until the browser closes |

The log never contains full addresses, page content, typed text, passwords, card numbers or
clipboard contents.

## What leaves the computer

Nothing, unless someone presses **Ask …**. That button opens WhatsApp, Telegram or the e-mail
program with a message filled in: what was stopped, the site name and the time. The person sends
it themselves, from their own account. Site names are written as `example[.]com` so messengers do
not turn them into clickable links.

## What ScamFuse does not do

- No analytics, no advertising, no third-party scripts.
- No code loaded from the internet: everything runs from the extension package.
- No browsing history is collected. The page scripts look at a page only to score a clipboard
  write or a possible fake alert, and only the verdict is used.
- No hidden mode. The icon is always visible and the pause screen names the trusted person.

## Children

The child profile is set up by a parent, who also gives consent. A child has no account and no
data on any server. The child sees the same log as the parent.

## Permissions

| Permission | Why |
| --- | --- |
| Access to all sites | The clipboard and fake alert checks must work on any page |
| `downloads` | To pause, resume or cancel a dangerous download |
| `storage` | Settings and the local log |

## Later versions

Version 0.2 adds an optional Telegram bot so the trusted person gets alerts automatically. It will
receive only the alert itself (kind, site name, time) and will be documented here before release.
