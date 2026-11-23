// Builds the message for the trusted person and the link that opens it in a messenger.
// Nothing is sent automatically: the link only opens a chat with the text filled in.

import { defang } from './domains.ts';
import { normalizePhone } from './settings.ts';
import type { Channel, EventKind, Profile } from './types.ts';
import type { Translator } from './i18n.ts';

export interface AskContext {
  kind: EventKind | 'page';
  host: string;
  title?: string;
  at: number;
  profile: Profile;
}

/** Message key for each kind of event. */
export function kindKey(kind: EventKind): string {
  return `kind_${kind.replace(/-/g, '_')}`;
}

export function buildAskMessage(tr: Translator, ctx: AskContext): string {
  const lines: string[] = [];
  if (ctx.kind === 'page') {
    lines.push(tr.t('msg_intro_page'));
    if (ctx.host) lines.push(tr.t('msg_site', { host: defang(ctx.host) }));
    if (ctx.title) lines.push(tr.t('msg_page_title', { title: ctx.title.slice(0, 120) }));
  } else {
    lines.push(tr.t('msg_intro'));
    lines.push(tr.t('msg_what', { what: tr.t(`msgwhat_${ctx.kind.replace(/-/g, '_')}`) }));
    if (ctx.host) lines.push(tr.t('msg_site', { host: defang(ctx.host) }));
    lines.push(tr.t('msg_time', { time: tr.time(ctx.at) }));
  }
  lines.push(tr.t('msg_ask'));
  return lines.join('\n');
}

export interface ContactTarget {
  channel: Channel;
  phone: string;
  email: string;
}

/** True when the chosen channel has what it needs. */
export function canAsk(target: ContactTarget): boolean {
  if (target.channel === 'email') return /\S+@\S+/.test(target.email);
  return normalizePhone(target.phone) !== '';
}

/**
 * Link that opens a chat with the trusted person and the message filled in.
 * WhatsApp: https://wa.me/<digits>?text=...  Telegram: https://t.me/+<digits>?text=...
 */
export function buildAskLink(target: ContactTarget, subject: string, message: string): string | null {
  const text = encodeURIComponent(message);
  if (target.channel === 'email') {
    const email = target.email.trim();
    if (!/\S+@\S+/.test(email)) return null;
    return `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${text}`;
  }
  const digits = normalizePhone(target.phone);
  if (!digits) return null;
  return target.channel === 'telegram'
    ? `https://t.me/+${digits}?text=${text}`
    : `https://wa.me/${digits}?text=${text}`;
}

/** Phone link for the "Or call" line. */
export function telLink(phone: string): string | null {
  const digits = normalizePhone(phone);
  return digits ? `tel:+${digits}` : null;
}

/**
 * The number for reading out loud. Country formats differ, so the person's own spacing is kept;
 * a number typed without spaces is shown with a plus.
 */
export function formatPhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = normalizePhone(trimmed);
  if (!digits) return trimmed;
  if (/[\s().-]/.test(trimmed)) return trimmed.startsWith('00') ? `+${trimmed.slice(2)}` : trimmed;
  return `+${digits}`;
}
