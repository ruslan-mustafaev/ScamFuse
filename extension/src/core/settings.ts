// Settings defaults and validation. Pure functions, no browser APIs.

import type { Channel, DetectorId, Mode, Profile, Settings } from './types.ts';

export const PROFILES: readonly Profile[] = ['elder', 'child', 'self'];
export const MODES: readonly Mode[] = ['advice', 'strict'];
export const CHANNELS: readonly Channel[] = ['whatsapp', 'telegram', 'email'];
export const DETECTORS: readonly DetectorId[] = [
  'remoteAccess',
  'clipboard',
  'fakeAlert',
  'programDownload',
];

export const ADVICE_DELAY_SECONDS = 15;
export const ALLOW_MINUTES = 30;
export const DEFAULT_LOCK_MINUTES = 30;
export const MIN_LOCK_MINUTES = 10;
export const MAX_LOCK_MINUTES = 24 * 60;
export const LOG_LIMIT = 200;
export const MAX_TRUSTED_SITES = 200;

export function defaultDetectors(profile: Profile): Record<DetectorId, boolean> {
  return {
    remoteAccess: true,
    clipboard: true,
    fakeAlert: true,
    programDownload: profile === 'child',
  };
}

/** Telegram is the more common messenger for Russian speakers; WhatsApp elsewhere. */
export function defaultChannel(language: string): Channel {
  const base = language.toLowerCase().split(/[-_]/)[0] ?? '';
  return ['ru', 'uk', 'be', 'kk', 'uz'].includes(base) ? 'telegram' : 'whatsapp';
}

export function defaultSettings(profile: Profile = 'elder', language = 'en'): Settings {
  return {
    version: 1,
    setupDone: false,
    enabled: true,
    profile,
    mode: 'advice',
    lockMinutes: DEFAULT_LOCK_MINUTES,
    guardianName: '',
    guardianPhone: '',
    guardianEmail: '',
    channel: defaultChannel(language),
    language: null,
    detectors: defaultDetectors(profile),
    trustedSites: [],
    pin: null,
  };
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Turns anything read from storage into valid settings. Unknown fields are dropped. */
export function normalizeSettings(raw: unknown, language = 'en'): Settings {
  const base = defaultSettings('elder', language);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const profile = oneOf(r.profile, PROFILES, base.profile);
  const detectorsRaw = (r.detectors && typeof r.detectors === 'object' ? r.detectors : {}) as Record<
    string,
    unknown
  >;
  const detectors = defaultDetectors(profile);
  for (const id of DETECTORS) {
    if (typeof detectorsRaw[id] === 'boolean') detectors[id] = detectorsRaw[id] as boolean;
  }
  const pinRaw = r.pin as Record<string, unknown> | null | undefined;
  const pin =
    pinRaw &&
    typeof pinRaw.salt === 'string' &&
    typeof pinRaw.hash === 'string' &&
    typeof pinRaw.iterations === 'number'
      ? { salt: pinRaw.salt, hash: pinRaw.hash, iterations: pinRaw.iterations }
      : null;
  const lock = typeof r.lockMinutes === 'number' ? Math.round(r.lockMinutes) : base.lockMinutes;
  const mode = oneOf(r.mode, MODES, base.mode);
  return {
    version: 1,
    setupDone: r.setupDone === true,
    enabled: r.enabled !== false,
    profile,
    // Strict mode without a PIN would lock people out with no way to unlock early.
    mode: mode === 'strict' && !pin ? 'advice' : mode,
    lockMinutes: Math.min(MAX_LOCK_MINUTES, Math.max(MIN_LOCK_MINUTES, lock)),
    guardianName: text(r.guardianName, 60),
    guardianPhone: text(r.guardianPhone, 32),
    guardianEmail: text(r.guardianEmail, 120),
    channel: oneOf(r.channel, CHANNELS, base.channel),
    language: typeof r.language === 'string' && r.language ? r.language.slice(0, 16) : null,
    detectors,
    trustedSites: Array.isArray(r.trustedSites)
      ? [...new Set(r.trustedSites.map((s) => normalizeHostInput(String(s))).filter(Boolean))].slice(
          0,
          MAX_TRUSTED_SITES,
        )
      : [],
    pin,
  };
}

/** Accepts "https://www.Example.com/path", "example.com" etc. Returns "example.com" or "". */
export function normalizeHostInput(input: string): string {
  let value = input.trim().toLowerCase();
  if (!value) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = `https://${value}`;
  try {
    const host = new URL(value).hostname.replace(/^www\./, '').replace(/\.$/, '');
    return /^[a-z0-9.-]+$/.test(host) && host.includes('.') ? host : '';
  } catch {
    return '';
  }
}

/** Phone as typed → digits with country code, or "" when it cannot be a full number. */
export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('00')) digits = digits.slice(2);
  return digits.length >= 8 && digits.length <= 15 ? digits : '';
}

export function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}
