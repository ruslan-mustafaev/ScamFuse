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

// ---------------------------------------------------------------- icons
// Simple line icons drawn for ScamFuse (24×24, stroke = currentColor). Built with DOM calls.

const SVG_NS = 'http://www.w3.org/2000/svg';

function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
}

const SHIELD = 'M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6z';

const ICONS = {
  shield: [SHIELD],
  'shield-check': [SHIELD, 'M8.5 12.2l2.4 2.4 4.6-4.8'],
  'shield-off': [SHIELD, 'M4 4l16 16'],
  stop: ['M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2z', 'M12 7.5v5.5', 'M12 16.5v.01'],
  alert: ['M10.3 4.2L2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z', 'M12 9.5v4', 'M12 17v.01'],
  info: [circle(12, 12, 9), 'M12 11v5.5', 'M12 7.8v.01'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  'check-circle': [circle(12, 12, 9), 'M8 12.3l2.8 2.8L16.2 9.5'],
  x: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  send: ['M21 3L10.5 13.5', 'M21 3l-6.5 18-4-7.5L3 9.5z'],
  mail: ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M3.5 6.5l8.5 6 8.5-6'],
  phone: ['M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5z', 'M11 18h2'],
  globe: [circle(12, 12, 9), 'M3 12h18', 'M12 3c2.8 3.2 2.8 14.8 0 18', 'M12 3c-2.8 3.2-2.8 14.8 0 18'],
  chevron: ['M9.5 6l6 6-6 6'],
  sliders: ['M4 7h9', 'M17 7h3', circle(15, 7, 2), 'M4 17h3', 'M11 17h9', circle(9, 17, 2)],
  play: ['M8 5.5v13l10.5-6.5z'],
  clock: [circle(12, 12, 9), 'M12 7.5V12l3 2'],
  lock: ['M6.5 11h11a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-7A1.5 1.5 0 0 1 6.5 11z', 'M8 11V8a4 4 0 0 1 8 0v3'],
  heart: ['M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z'],
  smile: [circle(12, 12, 9), 'M8.5 14.2a4.5 4.5 0 0 0 7 0', 'M9 9.5v.01', 'M15 9.5v.01'],
  user: [circle(12, 8, 4), 'M4.5 20.5a7.5 7.5 0 0 1 15 0'],
  users: [circle(9, 8.5, 3.5), 'M2.5 20a6.5 6.5 0 0 1 13 0', 'M16 5.2a3.5 3.5 0 0 1 0 6.6', 'M18 14.2a6.2 6.2 0 0 1 3.5 5.8'],
  list: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4.5 6v.01', 'M4.5 12v.01', 'M4.5 18v.01'],
  star: ['M12 3.5l2.6 5.3 5.9.9-4.3 4.2 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.2 5.9-.9z'],
  bell: ['M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z', 'M10 20.5a2.2 2.2 0 0 0 4 0'],
  scan: ['M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8', 'M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8', 'M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16', 'M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16', 'M7.5 12h9'],
  code: ['M8.5 7.5L4 12l4.5 4.5', 'M15.5 7.5L20 12l-4.5 4.5'],
} as const;

export type IconName = keyof typeof ICONS;

/** A line icon. Decorative: hidden from screen readers and adds no text to the element. */
export function icon(name: IconName, size = 24): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** An icon on a soft rounded square. Tone: brand (default), ok, warn, danger, muted. */
export function iconTile(name: IconName, tone = 'brand', size = 22): HTMLElement {
  return h('span', { class: `icon-tile tone-${tone}` }, icon(name, size));
}

/** Icon + label for buttons and links; the element's text stays just the label. */
export function withIcon(name: IconName, label: string, size = 22): (Node | string)[] {
  return [icon(name, size), h('span', {}, label)];
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
