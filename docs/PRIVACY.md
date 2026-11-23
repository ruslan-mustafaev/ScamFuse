# Privacy

ScamFuse runs on the computer where it is installed. The only server is the optional alert relay
for Telegram; without it, nothing leaves the computer by itself.

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

Without Telegram linked: nothing, unless someone presses **Ask …**. That button opens WhatsApp,
Telegram or the e-mail program with a message filled in: what was stopped, the site name and the
time. The person sends it themselves, from their own account.

With Telegram linked, the extension talks to the alert relay ([relay/](../relay/README.md)):

| Sent | When |
| --- | --- |
| A random install ID, a secret (stored there only as a hash), the computer's name for alerts, profile, language, time zone | Once, when Telegram is linked |
| Kind of action, site name, a one-time unlock code | When an action is stopped |
| "Switched off", "PIN entered wrong five times" | When it happens |
| "Still here" | Once a day |
| Removal notice | When the extension is removed (the browser opens the relay address) |

The relay keeps alerts for 30 days and the trusted person's Telegram chat ID and first name while
they are linked. It never receives addresses with paths, page content, typed text, card numbers or
clipboard contents. Site names are written as `example[.]com` so Telegram does not turn them into
clickable links. Unlinking in the settings deletes everything the relay keeps about the computer.

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
| `alarms` | The daily "still here" signal and retries when there is no internet |

## Bank cards and screen sharing

The card check only notices that a card number is being typed; the number stays on the page.
The screen sharing check only refuses the request; nothing is recorded.
