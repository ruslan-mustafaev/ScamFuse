// Language choice and message lookup.
//
// chrome.i18n.getMessage always follows the browser language and cannot be switched at runtime,
// so the extension reads the same _locales/<lang>/messages.json files with this module.

import type { Profile } from './types.ts';

/** Folder names under _locales. Add a language by adding its folder and its name here. */
export const SUPPORTED_LANGUAGES = ['en', 'ru'] as const;
export const DEFAULT_LANGUAGE = 'en';

/** Native names for the language menu. */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ru: 'Русский',
};

const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'yi']);

export interface ChromeMessage {
  message: string;
  description?: string;
}
export type MessageTable = Record<string, ChromeMessage>;

/** "pt-BR" / "pt_br" → "pt_BR" (the _locales folder convention). */
export function toLocaleFolder(tag: string): string {
  const [lang = '', region] = tag.replace(/-/g, '_').split('_');
  return region ? `${lang.toLowerCase()}_${region.toUpperCase()}` : lang.toLowerCase();
}

function match(tag: string, supported: readonly string[]): string | null {
  if (!tag) return null;
  const folder = toLocaleFolder(tag);
  if (supported.includes(folder)) return folder;
  const base = folder.split('_')[0] ?? '';
  if (supported.includes(base)) return base;
  return null;
}

/**
 * Order: manual choice → browser UI language (follows the system by default)
 * → the browser's preferred languages → English.
 */
export function resolveLanguage(
  manual: string | null,
  uiLanguage: string,
  preferred: readonly string[],
  supported: readonly string[] = SUPPORTED_LANGUAGES,
): string {
  for (const candidate of [manual ?? '', uiLanguage, ...preferred]) {
    const found = match(candidate, supported);
    if (found) return found;
  }
  return DEFAULT_LANGUAGE;
}

export function isRtl(language: string): boolean {
  return RTL_LANGUAGES.has((language.split(/[-_]/)[0] ?? '').toLowerCase());
}

/** BCP 47 tag for Intl: "pt_BR" → "pt-BR". */
export function toBcp47(language: string): string {
  return language.replace(/_/g, '-');
}

export class Translator {
  readonly language: string;
  private readonly table: MessageTable;
  private readonly fallback: MessageTable;

  constructor(language: string, table: MessageTable, fallback: MessageTable = {}) {
    this.language = language;
    this.table = table;
    this.fallback = fallback;
  }

  has(key: string): boolean {
    return key in this.table || key in this.fallback;
  }

  /** Message by key with {name} substitutions. Unknown keys return the key itself. */
  t(key: string, subs: Record<string, string | number> = {}): string {
    const entry = this.table[key] ?? this.fallback[key];
    const template = entry ? entry.message : key;
    return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in subs ? String(subs[name]) : whole,
    );
  }

  /** Profile-specific text first ("key__child"), then the common one. */
  tp(key: string, profile: Profile, subs: Record<string, string | number> = {}): string {
    const specific = `${key}__${profile}`;
    return this.has(specific) ? this.t(specific, subs) : this.t(key, subs);
  }

  time(at: number): string {
    return new Intl.DateTimeFormat(toBcp47(this.language), {
      hour: '2-digit',
      minute: '2-digit',
    }).format(at);
  }

  dateTime(at: number): string {
    return new Intl.DateTimeFormat(toBcp47(this.language), {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(at);
  }
}

/** Placeholders a translation must keep, e.g. "{name}". Used by the translation test. */
export function placeholdersOf(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
}
