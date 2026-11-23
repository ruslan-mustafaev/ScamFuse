// Runs in the extension's isolated world on every page. The page cannot change this
// script's built-ins, so all decisions happen here, never in the page's own context.

import siteRules from '../rules/sites.json' with { type: 'json' };
import { isVisibleIn, scoreClipboard } from '../core/clipboard-score.ts';
import { hostMatches } from '../core/domains.ts';
import { isCardField, looksLikeCardNumber } from '../core/cards.ts';
import { analyzeHost, type PageFacts, scoreSite } from '../core/site-risk.ts';
import { BEHAVIOUR_WEIGHTS, scoreFakeAlert } from '../core/fake-alert-score.ts';
import type { ContentMessage, Level, PageStatus, SignalKind, SiteCheck } from '../core/types.ts';

const VERDICT_ATTRIBUTE = 'data-scamfuse-verdict';
const REPORT_INTERVAL_MS = 10_000;
const FALLBACK_SAFE_TEXT =
  '# ScamFuse removed a dangerous command here. Do not run what a website asked you to paste.';

const host = location.hostname.toLowerCase().replace(/^www\./, '');
const isTop = window === window.top;
const legitimateSecuritySite = hostMatches(host, siteRules.legitimateSecuritySites);

// Until the background answers, protect by default (developer sites excepted).
const status: PageStatus = {
  clipboard: !hostMatches(host, siteRules.developerSites),
  fakeAlert: true,
  screenShare: !hostMatches(host, siteRules.meetingSites),
  cardEntry: false,
  phishing: true,
  safeText: FALLBACK_SAFE_TEXT,
};

function message(payload: ContentMessage): Promise<unknown> {
  try {
    return chrome.runtime.sendMessage(payload).catch(() => undefined);
  } catch {
    // The extension was updated or removed; this old copy of the script stays silent.
    return Promise.resolve(undefined);
  }
}

if (/^https?:$/.test(location.protocol) || location.protocol === 'file:' || location.href === 'about:blank') {
  void message({ type: 'pageStatus' }).then((reply) => {
    if (reply && typeof reply === 'object') Object.assign(status, reply as PageStatus);
  });
}

const lastReport: Record<string, number> = {};
function report(kind: SignalKind, reasons: string[], level?: Level, detail?: string): void {
  const now = Date.now();
  if (now - (lastReport[kind] ?? 0) < REPORT_INTERVAL_MS) return;
  lastReport[kind] = now;
  void message({ type: 'signal', kind, reasons, level, detail });
}

function visibleText(): string {
  return document.body?.innerText ?? '';
}

// ------------------------------------------------------------------ clipboard

function clipboardIsDangerous(text: string, scriptWritten: boolean): boolean {
  if (!status.clipboard) return false;
  if (text.trim().length < 4) return false;
  const pageText = visibleText();
  const verdict = scoreClipboard({
    text,
    scriptWritten,
    visibleOnPage: isVisibleIn(text, pageText),
    pageText,
  });
  if (!verdict.high) return false;
  report('clipboard', verdict.reasons);
  return true;
}

// Synchronous question from the page hooks: "may this text go to the clipboard?"
document.addEventListener(
  'scamfuse:clipboard',
  (event) => {
    event.stopImmediatePropagation();
    let verdict = { block: false, safe: '' };
    try {
      const detail = JSON.parse(String((event as CustomEvent).detail)) as {
        text?: unknown;
        scriptWritten?: unknown;
      };
      if (clipboardIsDangerous(String(detail.text ?? ''), detail.scriptWritten === true)) {
        verdict = { block: true, safe: status.safeText };
      }
    } catch {
      // Malformed question: answer "no objection".
    }
    document.documentElement?.setAttribute(VERDICT_ATTRIBUTE, JSON.stringify(verdict));
  },
  true,
);

let scriptCopy = false;
document.addEventListener(
  'scamfuse:exec-copy',
  (event) => {
    event.stopImmediatePropagation();
    scriptCopy = true;
  },
  true,
);

function selectedText(): string {
  const active = document.activeElement;
  if (
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLInputElement && /^(text|search|url|tel|password)$/.test(active.type))
  ) {
    const { selectionStart, selectionEnd, value } = active;
    if (selectionStart !== null && selectionEnd !== null && selectionEnd > selectionStart) {
      return value.slice(selectionStart, selectionEnd);
    }
  }
  return window.getSelection()?.toString() ?? '';
}

// Copying a selection (by the person or by execCommand from a script).
window.addEventListener(
  'copy',
  (event) => {
    const byScript = scriptCopy;
    scriptCopy = false;
    const text = selectedText();
    if (!text || !event.clipboardData) return;
    if (clipboardIsDangerous(text, byScript)) {
      event.clipboardData.setData('text/plain', status.safeText);
      event.preventDefault();
    }
  },
  true,
);

// ------------------------------------------------------------------ screen sharing

document.addEventListener(
  'scamfuse:screen',
  (event) => {
    event.stopImmediatePropagation();
    const block = status.screenShare;
    if (block) report('screen-share', ['screen-share']);
    document.documentElement?.setAttribute(VERDICT_ATTRIBUTE, JSON.stringify({ block }));
  },
  true,
);

// ------------------------------------------------------------------ bank card entry (child profile)

let cardReported = false;
document.addEventListener(
  'input',
  (event) => {
    if (cardReported || !status.cardEntry) return;
    const field = event.target;
    if (!(field instanceof HTMLInputElement)) return;
    const hints = {
      autocomplete: field.autocomplete ?? '',
      name: field.name ?? '',
      id: field.id ?? '',
      placeholder: field.placeholder ?? '',
      label: field.getAttribute('aria-label') ?? '',
    };
    const byField = isCardField(hints);
    if (!byField && !looksLikeCardNumber(field.value)) return;
    cardReported = true;
    report('card-entry', [byField ? 'card-field' : 'card-number']);
  },
  true,
);

// ------------------------------------------------------------------ fake sites (phishing)

const SEED_WORDS =
  /(seed|recovery|secret|mnemonic)\s+phrase|\b(12|24)[\s-]word|сид-?фраз|секретн\w*\s+фраз|мнемоническ\w*\s+фраз|фраз\w*\s+восстановлени/i;
const ONE_TIME_CODE = /(otp|one.?time|sms.?code|verification.?code|код.?из.?(смс|sms)|одноразов)/i;
const SENSITIVE_SELECTOR = 'input[type="password"], input[autocomplete~="cc-number"], input[autocomplete="one-time-code"], textarea';

function fieldHints(field: HTMLInputElement) {
  return {
    autocomplete: field.autocomplete ?? '',
    name: field.name ?? '',
    id: field.id ?? '',
    placeholder: field.placeholder ?? '',
    label: field.getAttribute('aria-label') ?? '',
  };
}

function hostOfUrl(value: string | null | undefined): string {
  if (!value) return '';
  try {
    return new URL(value, location.href).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Reads what the check needs from the page. Nothing of it leaves the page. */
function collectFacts(): PageFacts {
  const fields = Array.from(document.querySelectorAll('input, textarea')).slice(0, 300);
  const inputs = fields.filter((field): field is HTMLInputElement => field instanceof HTMLInputElement);
  const passwords = inputs.filter((field) => field.type === 'password');
  const cards = inputs.filter((field) => isCardField(fieldHints(field)));
  const codes = inputs.filter(
    (field) => field.autocomplete === 'one-time-code' || ONE_TIME_CODE.test(`${field.name} ${field.id} ${field.placeholder}`),
  );
  const bodyText = (document.body?.innerText ?? '').slice(0, 8000);
  const textInputs = inputs.filter((field) => field.type === 'text' || field.type === 'password').length;
  const hasTextarea = fields.some((field) => field instanceof HTMLTextAreaElement);

  const formTexts: string[] = [];
  const actions: string[] = [];
  for (const field of [...passwords, ...cards].slice(0, 5)) {
    const form = field.form ?? field.closest('div, section, main');
    if (form) formTexts.push(((form as HTMLElement).innerText ?? '').slice(0, 1000));
    if (field.form && passwords.includes(field)) actions.push(hostOfUrl(field.form.getAttribute('action') || location.href));
  }
  const headings = [
    ...Array.from(document.querySelectorAll('h1, h2')).slice(0, 6).map((node) => (node as HTMLElement).innerText ?? ''),
    ...Array.from(document.images).slice(0, 10).map((image) => image.alt),
  ].join(' ');
  const assetHosts = [
    ...Array.from(document.images).slice(0, 40).map((image) => hostOfUrl(image.currentSrc || image.src)),
    ...Array.from(document.querySelectorAll('link[rel~="icon"]')).map((link) => hostOfUrl(link.getAttribute('href'))),
  ].filter(Boolean);
  const telegramBot =
    Array.from(document.scripts).some((script) => !script.src && (script.textContent ?? '').includes('api.telegram.org/bot')) ||
    actions.some((action) => action === 'api.telegram.org');

  return {
    host,
    https: location.protocol === 'https:',
    title: document.title,
    headings,
    formText: formTexts.join(' '),
    hasPassword: passwords.length > 0,
    hasCard: cards.length > 0,
    hasOneTimeCode: codes.length > 0,
    asksSeedPhrase: SEED_WORDS.test(bodyText) && (hasTextarea || textInputs >= 12),
    formActionHosts: actions,
    assetHosts,
    telegramBot,
    bodyText,
  };
}

let siteCheck: SiteCheck = { level: 'low', reasons: [], brand: null };
let siteReported = '';
const domainMarkers = analyzeHost(host).markers.length > 0;

function checkSite(): SiteCheck {
  if (!/^https?:$/.test(location.protocol)) return siteCheck;
  const verdict = scoreSite(collectFacts());
  siteCheck = { level: verdict.level, reasons: verdict.reasons, brand: verdict.brand };
  if (siteCheck.level !== siteReported) {
    siteReported = siteCheck.level;
    void message({ type: 'siteReport', level: siteCheck.level });
  }
  if (status.phishing && siteCheck.level === 'high') report('phishing', siteCheck.reasons, 'high', siteCheck.brand ?? undefined);
  return siteCheck;
}

function scheduleSiteCheck(): void {
  if (!isTop) return;
  // Most pages have nothing to steal and an ordinary address: skip the work for them.
  if (!domainMarkers && !document.querySelector(SENSITIVE_SELECTOR) && !SEED_WORDS.test(document.title)) {
    if (siteReported !== 'low') {
      siteReported = 'low';
      void message({ type: 'siteReport', level: 'low' });
    }
    return;
  }
  checkSite();
}

// Before anything is typed into a password, card, code or phrase field on a suspicious page.
document.addEventListener(
  'focusin',
  (event) => {
    if (!isTop || !status.phishing) return;
    const field = event.target;
    const sensitive =
      field instanceof HTMLTextAreaElement ||
      (field instanceof HTMLInputElement &&
        (field.type === 'password' || isCardField(fieldHints(field)) || field.autocomplete === 'one-time-code'));
    if (!sensitive) return;
    const verdict = checkSite();
    if (verdict.level === 'medium') report('phishing', verdict.reasons, 'medium', verdict.brand ?? undefined);
  },
  true,
);

// The toolbar window asks how this page looks.
try {
  chrome.runtime.onMessage.addListener((request: unknown, sender, respond) => {
    if (!isTop || sender.id !== chrome.runtime.id || (request as { type?: string })?.type !== 'siteCheck') return false;
    respond(checkSite());
    return false;
  });
} catch {
  // The extension was updated; this old copy stays silent.
}

// ------------------------------------------------------------------ fake virus alerts

const behaviour = new Set<string>();
let fakeAlertReported = false;
let evaluateTimer: ReturnType<typeof setTimeout> | undefined;

function evaluateFakeAlert(): void {
  if (fakeAlertReported || !status.fakeAlert) return;
  if (legitimateSecuritySite) return;
  if (!isTop && behaviour.size === 0) return;
  const verdict = scoreFakeAlert({ text: visibleText(), title: document.title, behaviour });
  if (!verdict.high) return;
  fakeAlertReported = true;
  document.dispatchEvent(new CustomEvent('scamfuse:flagged'));
  report('fake-alert', verdict.reasons);
}

function scheduleEvaluate(delay: number): void {
  if (evaluateTimer !== undefined) clearTimeout(evaluateTimer);
  evaluateTimer = setTimeout(() => {
    evaluateTimer = undefined;
    evaluateFakeAlert();
  }, delay);
}

document.addEventListener(
  'scamfuse:signal',
  (event) => {
    event.stopImmediatePropagation();
    const name = String((event as CustomEvent).detail);
    if (!(name in BEHAVIOUR_WEIGHTS)) return;
    behaviour.add(name);
    scheduleEvaluate(300);
  },
  true,
);

function startPageChecks(): void {
  evaluateFakeAlert();
  setTimeout(evaluateFakeAlert, 1500);
  setTimeout(evaluateFakeAlert, 4000);
  setTimeout(scheduleSiteCheck, 800);
  setTimeout(scheduleSiteCheck, 3000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startPageChecks, { once: true });
} else {
  startPageChecks();
}
