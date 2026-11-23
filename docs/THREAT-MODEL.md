# What ScamFuse can and cannot do

ScamFuse slows down a dangerous action and brings a trusted person in. It does not lock anyone in
and it sees only what happens inside the browser.

## Covered

- Downloads of remote access programs, recognised by site, by the file name in the link and by the
  saved file name.
- Pages of remote access programs (web-based sessions included).
- Commands written into the clipboard by a page: `navigator.clipboard.writeText` and `write`,
  copy handlers that call `setData`, and `document.execCommand('copy')` with a hidden text field.
- Fake virus alerts: alarm phrases (English and Russian), a "support" phone number, and trap
  behaviour such as full screen, keyboard lock, dialog loops and Back-button traps.
- Executable downloads from unofficial sites (child profile).
- Screen sharing requested by a site that is not a known meeting service.
- Bank card numbers typed on a site (child profile).
- Fake sites (phishing), by markers on the address and on the page:
  look-alike letters and one-letter differences from 36 commonly imitated brands, a brand name
  mixed into another address or put at its start, mixed Latin and Cyrillic, a known brand's name and
  logo on a page that asks for a password, a card, a one-time code or a wallet phrase, passwords sent
  to another site or to a Telegram bot, typical phishing phrases (English and Russian), free site
  builders, address endings popular with scammers, bare IP addresses, password fields without
  encryption. A clear fake is stopped when it opens; a suspicious page before anything is typed.

## Not covered

- Anything outside the browser: phone calls, messenger chats, banking apps, programs already
  installed.
- Mobile browsers: they do not run extensions.
- A person who removes the extension or opens another browser. Removal cannot be prevented by an
  extension; with Telegram linked, the trusted person is told when it happens. Switching the
  extension off in the browser is not reported by the browser, so the relay reports a computer
  that is silent for 7 days. On Chromebooks, Family Link can block removal.
- Commands typed by hand from a video or a phone call.
- Archives: a program inside a `.zip` is not seen until it is unpacked outside the browser.
- Fake sites of brands that are not in the list and that copy no known brand's name: they are caught
  only by the other markers. Domain age and lists of known phishing addresses are not used yet
  (planned with the rule updates).

## How the page scripts are protected

- The hook in the page's context saves the browser's built-in functions before any page script
  runs, so a page that later replaces them cannot blind it.
- The hook makes no decisions. It asks the extension's isolated script, which the page cannot
  modify, and gets the answer synchronously.
- Signals from the page can only start a pause, never cancel one. A page that fakes a signal can
  only pause itself.
- Known gaps: a page can grab clipboard functions from a fresh frame before ScamFuse injects
  into it, and the scoring rules are public, so a page can try to avoid them. Rules will be
  updated without a new release from version 0.3.

## False alarms

Copy buttons on documentation sites are allowed when the copied command is visible on the page.
Developer sites (GitHub, Microsoft Learn, Docker docs, Homebrew, Stack Overflow and others) are
never checked for clipboard commands. Anyone can add trusted sites in the settings.

Found a scam ScamFuse misses, or a false alarm? Open an issue with the site name and what happened.
