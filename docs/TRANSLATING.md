# Adding a language

1. Copy `extension/public/_locales/en/` to `extension/public/_locales/<code>/` (for example `de`, or
   `pt_BR` for a regional variant) and translate every `message` in `messages.json`.
   - Keep placeholders such as `{name}` exactly as they are.
   - `btn_ask` shows `Ask {name}`, where `{name}` is typed by the user as it should appear on the
     button ("Dad", "папу"). Write it so that this works in your language.
   - `clip_safe` must start with `#` and must not contain quotes or `| & < > $ ; \`: it replaces a
     dangerous command, and someone may paste and run it.
   - Short sentences, no technical words. The pause screen is read by worried people.
2. Add the code to `SUPPORTED_LANGUAGES` and its own name to `LANGUAGE_NAMES` in
   `extension/src/core/i18n.ts`.
3. Optional but valuable: add `extension/src/rules/dictionaries/<code>.json` with the phrases fake
   virus alerts use in your language, and import it in `extension/src/core/fake-alert-score.ts`.
4. Run `npm test`. It fails if a key is missing, a placeholder differs, or `clip_safe` is unsafe.
