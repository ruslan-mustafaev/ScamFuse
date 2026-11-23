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

## Not covered

- Anything outside the browser: phone calls, messenger chats, banking apps, programs already
  installed.
- Mobile browsers: they do not run extensions.
- A person who removes the extension or opens another browser. Removal cannot be prevented by an
  extension; version 0.2 tells the trusted person when it happens. On Chromebooks, Family Link can
  block removal.
- Commands typed by hand from a video or a phone call.
- Archives: a program inside a `.zip` is not seen until it is unpacked outside the browser.

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
