// Checks a site for signs of phishing: the address first, then what the page asks for.
//
// Every marker has a code (shown to the person as a reason) and a weight. A page is only
// stopped when it both looks fake and asks for something valuable: a password, a card,
// a one-time code or a wallet recovery phrase.

import brandRules from '../rules/brands.json' with { type: 'json' };
import en from '../rules/dictionaries/en.json' with { type: 'json' };
import ru from '../rules/dictionaries/ru.json' with { type: 'json' };
import { hostMatches } from './domains.ts';
import { toUnicodeHost } from './punycode.ts';

export interface Brand {
  name: string;
  domains: string[];
  marks: string[];
  label: string;
  anyCountry?: boolean;
  /** The brand is also an ordinary word: one-letter differences are normal for it. */
  word?: boolean;
}

export const BRANDS: readonly Brand[] = brandRules.brands;
const FREE_HOSTING: readonly string[] = brandRules.freeHosting;
const RISKY_TLDS: ReadonlySet<string> = new Set(brandRules.riskyTlds);
const RISKY_COUNTRY_TLDS: ReadonlySet<string> = new Set(brandRules.riskyCountryTlds);
const BAIT: ReadonlySet<string> = new Set(brandRules.bait);
const LEGITIMATE_LOOKALIKES: readonly string[] = brandRules.legitimateLookalikes;
const PHISHING_PHRASES: readonly string[] = [...en.phishing, ...ru.phishing];

/** Two-part endings where the name sits one level deeper: "bank.co.uk". */
const SECOND_LEVEL = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'com.au', 'net.au', 'org.au', 'co.jp', 'ne.jp', 'or.jp',
  'com.br', 'com.tr', 'com.mx', 'com.ar', 'co.in', 'co.za', 'co.kr', 'com.cn', 'com.ua', 'co.il',
  'com.sg', 'com.my', 'com.hk', 'com.tw', 'co.nz', 'co.id', 'com.pl', 'com.vn', 'com.ng', 'com.eg',
  'com.sa', 'com.pk', 'com.kz',
]);

/** Domain codes whose marker means "the address imitates a brand". */
const STRONG_DOMAIN = new Set(['homoglyph', 'lookalike', 'brand-in-domain', 'brand-subdomain', 'brand-wrong-tld', 'mixed-script']);

export interface Marker {
  code: string;
  weight: number;
}

export interface SiteVerdict {
  level: 'low' | 'medium' | 'high';
  score: number;
  reasons: string[];
  brand: string | null;
}

// ------------------------------------------------------------------ letters that look alike

const CONFUSABLE: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ԁ: 'd', ѕ: 's', һ: 'h',
  ӏ: 'l', к: 'k', м: 'm', т: 't', ν: 'v', ο: 'o', α: 'a', ρ: 'p', ι: 'i', τ: 't', κ: 'k',
  ı: 'i', ł: 'l', ⅼ: 'l', ɡ: 'g', '0': 'o', '1': 'l', '3': 'e', '5': 's', '|': 'l',
};

/** Reduces a label to how it looks: "раураl" (Cyrillic) and "paypa1" both become "paypal". */
export function skeleton(text: string): string {
  const plain = text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  for (const char of plain) out += CONFUSABLE[char] ?? char;
  return out.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/cl/g, 'd');
}

/** Edits (insert, delete, replace, swap neighbours) between two strings, stopping above `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i += 1) {
    rows.push([i]);
  }
  for (let j = 1; j <= b.length; j += 1) (rows[0] as number[])[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    const row = rows[i] as number[];
    const prev = rows[i - 1] as number[];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, ((rows[i - 2] as number[])[j - 2] ?? 0) + 1);
      }
      row[j] = value;
    }
  }
  return (rows[a.length] as number[])[b.length] ?? max + 1;
}

// ------------------------------------------------------------------ the address

export interface HostParts {
  /** Labels in front of the registered name: ["login", "paypal", "com"] in login.paypal.com.evil.top */
  sub: string[];
  /** The registered name itself: "evil" */
  name: string;
  /** Its ending: "top", "co.uk" */
  suffix: string;
}

export function splitHost(host: string): HostParts {
  const labels = host.split('.').filter(Boolean);
  const lastTwo = labels.slice(-2).join('.');
  const suffixLength = labels.length > 2 && SECOND_LEVEL.has(lastTwo) ? 2 : 1;
  const suffix = labels.slice(-suffixLength).join('.');
  const name = labels[labels.length - suffixLength - 1] ?? '';
  return { sub: labels.slice(0, Math.max(0, labels.length - suffixLength - 1)), name, suffix };
}

export function registrable(host: string): string {
  const parts = splitHost(host);
  return parts.name ? `${parts.name}.${parts.suffix}` : host;
}

/** The brand whose official site this is, if any. */
export function officialBrand(host: string): Brand | null {
  for (const brand of BRANDS) {
    if (hostMatches(host, brand.domains)) return brand;
    if (brand.anyCountry) {
      const { name, suffix } = splitHost(host);
      const country = suffix.split('.').pop() ?? '';
      if (name === brand.label && country.length === 2 && !RISKY_COUNTRY_TLDS.has(country)) return brand;
    }
  }
  return null;
}

function isIp(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

function hasMixedScripts(label: string): boolean {
  return /[a-z]/i.test(label) && /[Ѐ-ӿͰ-Ͽ]/.test(label);
}

/** How a single label relates to a brand label. */
function compareLabel(label: string, brand: Brand): string | null {
  if (!label || brand.label.length < 4) return null;
  const target = skeleton(brand.label);
  const shape = skeleton(label);
  if (label === brand.label) return 'exact';
  if (shape === target) return 'homoglyph';
  const allowed = brand.word ? 0 : target.length >= 10 ? 2 : target.length >= 6 ? 1 : 0;
  if (allowed && editDistance(shape, target, allowed) <= allowed) return 'lookalike';
  const tokens = shape.split(/[-_]+/).filter(Boolean);
  if (tokens.length > 1 && tokens.includes(target)) return 'embedded';
  for (const word of BAIT) {
    if (shape === `${target}${word}` || shape === `${word}${target}`) return 'embedded';
  }
  return null;
}

export interface DomainFinding {
  markers: Marker[];
  brand: Brand | null;
  official: boolean;
}

export function analyzeHost(rawHost: string): DomainFinding {
  const host = rawHost.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const markers: Marker[] = [];
  if (!host) return { markers, brand: null, official: false };
  if (isIp(host)) return { markers: [{ code: 'ip-host', weight: 2 }], brand: null, official: false };
  const official = officialBrand(host);
  if (official || hostMatches(host, LEGITIMATE_LOOKALIKES)) return { markers, brand: official, official: true };

  const unicode = toUnicodeHost(host);
  const parts = splitHost(unicode);
  const freeHosting = hostMatches(host, FREE_HOSTING);
  if (freeHosting) markers.push({ code: 'free-hosting', weight: 1 });
  const tld = unicode.split('.').pop() ?? '';
  if (RISKY_TLDS.has(tld)) markers.push({ code: 'risky-tld', weight: 1 });
  if (unicode.split('.').some(hasMixedScripts)) markers.push({ code: 'mixed-script', weight: 3 });
  if ((parts.name.match(/-/g) ?? []).length >= 3 || host.length > 50) markers.push({ code: 'many-hyphens', weight: 1 });

  // On a free hosting service the name that matters is the user's subdomain.
  const mainLabel = freeHosting ? (parts.sub[parts.sub.length - 1] ?? parts.name) : parts.name;
  const extraLabels = freeHosting ? parts.sub.slice(0, -1) : parts.sub;

  let best: { code: string; weight: number; brand: Brand } | null = null;
  const consider = (code: string, weight: number, brand: Brand) => {
    if (!best || weight > best.weight) best = { code, weight, brand };
  };
  for (const brand of BRANDS) {
    const relation = compareLabel(mainLabel, brand);
    if (relation === 'exact') consider('brand-wrong-tld', 6, brand);
    else if (relation === 'homoglyph') consider('homoglyph', 6, brand);
    else if (relation === 'lookalike') consider('lookalike', 6, brand);
    else if (relation === 'embedded') consider('brand-in-domain', 5, brand);
    for (const label of extraLabels) {
      const sub = compareLabel(label, brand);
      if (sub === 'exact' || sub === 'homoglyph') consider('brand-subdomain', 5, brand);
    }
  }
  const match = best as { code: string; weight: number; brand: Brand } | null;
  if (match) markers.push({ code: match.code, weight: match.weight });
  return { markers, brand: match?.brand ?? null, official: false };
}

// ------------------------------------------------------------------ the page

export interface PageFacts {
  host: string;
  https: boolean;
  title: string;
  /** h1/h2 text and logo descriptions. */
  headings: string;
  /** Text of the form that holds the password or card field. */
  formText: string;
  hasPassword: boolean;
  hasCard: boolean;
  hasOneTimeCode: boolean;
  /** The page talks about a wallet recovery phrase and has room to type it. */
  asksSeedPhrase: boolean;
  /** Where forms with a password field send their data. */
  formActionHosts: string[];
  /** Hosts of images and icons on the page. */
  assetHosts: string[];
  /** A script on the page talks to the Telegram bot API. */
  telegramBot: boolean;
  bodyText: string;
}

const SIGN_IN_WITH =
  /(sign\s*in|log\s*in|login|continue|sign\s*up|register|войти|вход|продолжить|зарегистрироваться)\s+(with|via|through|using|через|с\s+помощью)\s+[\p{L}\d.]+/giu;

function brandOnPage(facts: PageFacts, host: string): Brand | null {
  const clean = (text: string) => text.toLowerCase().replace(SIGN_IN_WITH, ' ');
  const form = clean(facts.formText);
  const title = clean(facts.title);
  const headings = clean(facts.headings);
  for (const brand of BRANDS) {
    if (hostMatches(host, brand.domains)) continue;
    const named = (text: string) => brand.marks.some((mark) => text.includes(mark));
    if (named(form) || (named(title) && named(headings))) return brand;
  }
  return null;
}

export function scoreSite(facts: PageFacts): SiteVerdict {
  const domain = analyzeHost(facts.host);
  if (domain.official) return { level: 'low', score: 0, reasons: [], brand: null };
  const markers: Marker[] = [...domain.markers];
  const credential = facts.hasPassword || facts.hasCard || facts.hasOneTimeCode || facts.asksSeedPhrase;
  const pageBrand = credential ? brandOnPage(facts, facts.host) : null;
  const brand = domain.brand ?? pageBrand;

  if (pageBrand) markers.push({ code: 'brand-content', weight: 4 });
  if (brand && credential && facts.assetHosts.some((asset) => hostMatches(asset, brand.domains))) {
    markers.push({ code: 'brand-assets', weight: 2 });
  }
  const own = registrable(facts.host);
  if (
    facts.hasPassword &&
    facts.formActionHosts.some((action) => action && registrable(action) !== own && !officialBrand(action))
  ) {
    markers.push({ code: 'foreign-form', weight: 2 });
  }
  if (facts.telegramBot && credential) markers.push({ code: 'telegram-exfil', weight: 6 });
  if (facts.asksSeedPhrase) markers.push({ code: 'seed-phrase', weight: 6 });
  if (!facts.https && (facts.hasPassword || facts.hasCard)) markers.push({ code: 'insecure-password', weight: 2 });

  const text = facts.bodyText.toLowerCase();
  const phrases = PHISHING_PHRASES.filter((phrase) => text.includes(phrase)).length;
  if (phrases) markers.push({ code: 'phishing-words', weight: Math.min(phrases, 3) });

  const score = markers.reduce((sum, marker) => sum + marker.weight, 0);
  const codes = markers.map((marker) => marker.code);
  const strongDomain = codes.some((code) => STRONG_DOMAIN.has(code));
  const strong = strongDomain || codes.includes('telegram-exfil') || codes.includes('seed-phrase');

  let level: SiteVerdict['level'] = 'low';
  if (
    (credential && score >= 8 && (strong || pageBrand !== null)) ||
    codes.includes('telegram-exfil') ||
    (strongDomain && phrases >= 2)
  ) {
    level = 'high';
  } else if ((credential && score >= 5) || strongDomain || facts.asksSeedPhrase) {
    level = 'medium';
  }
  return { level, score, reasons: codes, brand: brand?.name ?? null };
}
