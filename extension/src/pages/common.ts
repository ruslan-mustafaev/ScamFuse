// Helpers shared by the extension pages. Pages are built with DOM calls and textContent only:
// no HTML strings, so nothing from a website can ever be rendered as markup.

import { MADE_BY_NAME, MADE_BY_URL } from '../core/config.ts';
import { isRtl, LANGUAGE_NAMES, SUPPORTED_LANGUAGES, toBcp47, type Translator } from '../core/i18n.ts';
import type { PageMessage } from '../core/types.ts';
import { getTranslator } from '../shared/runtime-i18n.ts';

export function send<T>(message: PageMessage): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      element.className = String(value);
    } else if (value === true) {
      element.setAttribute(key, '');
    } else {
      element.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return element;
}

export async function translator(manual: string | null): Promise<Translator> {
  const tr = await getTranslator(manual);
  document.documentElement.lang = toBcp47(tr.language);
  document.documentElement.dir = isRtl(tr.language) ? 'rtl' : 'ltr';
  return tr;
}

/** Language menu: "Automatic" plus every translated language in its own name. */
export function languageSelect(
  tr: Translator,
  current: string | null,
  onChange: (language: string | null) => void,
): HTMLElement {
  const select = h('select', { 'aria-label': tr.t('lang_label'), class: 'lang-select' });
  select.append(h('option', { value: '' }, tr.t('lang_auto')));
  for (const code of SUPPORTED_LANGUAGES) {
    select.append(h('option', { value: code }, LANGUAGE_NAMES[code] ?? code));
  }
  select.value = current ?? '';
  select.addEventListener('change', () => onChange(select.value || null));
  return select;
}

export function logo(): HTMLElement {
  const img = h('img', { src: '../icons/on-48.png', alt: '', width: 32, height: 32 });
  return h('div', { class: 'brand' }, img, h('span', {}, 'ScamFuse'));
}

/** "made by Dev - Interactive" in small print. Not shown on the pause screen. */
export function madeBy(): HTMLElement {
  return h('p', { class: 'made-by' },
    'made by ',
    h('a', { href: MADE_BY_URL, target: '_blank', rel: 'noopener' }, MADE_BY_NAME),
  );
}

export function mount(...nodes: Node[]): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.replaceChildren(...nodes);
}

export function kindSuffix(kind: string): string {
  return kind.replace(/-/g, '_');
}

/** Human label for a reason code such as "powershell" or "words:5". */
export function reasonLabel(tr: Translator, code: string): string {
  const key = `reason_${kindSuffix(code.split(':')[0] ?? code)}`;
  return tr.has(key) ? tr.t(key) : code;
}
