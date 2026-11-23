// Loads translations inside the extension (background worker and extension pages).

import {
  DEFAULT_LANGUAGE,
  type MessageTable,
  resolveLanguage,
  Translator,
} from '../core/i18n.ts';

const tables = new Map<string, Promise<MessageTable>>();

function loadTable(language: string): Promise<MessageTable> {
  let table = tables.get(language);
  if (!table) {
    table = fetch(chrome.runtime.getURL(`_locales/${language}/messages.json`))
      .then((response) => (response.ok ? (response.json() as Promise<MessageTable>) : {}))
      .catch(() => ({}));
    tables.set(language, table);
  }
  return table;
}

export function currentLanguage(manual: string | null): string {
  const preferred = typeof navigator !== 'undefined' && navigator.languages ? navigator.languages : [];
  return resolveLanguage(manual, chrome.i18n.getUILanguage(), preferred);
}

export async function getTranslator(manual: string | null): Promise<Translator> {
  const language = currentLanguage(manual);
  const [table, fallback] = await Promise.all([
    loadTable(language),
    language === DEFAULT_LANGUAGE ? Promise.resolve({}) : loadTable(DEFAULT_LANGUAGE),
  ]);
  return new Translator(language, table, fallback);
}
