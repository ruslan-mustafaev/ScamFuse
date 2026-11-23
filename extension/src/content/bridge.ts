// Runs in the extension's isolated world on every page. The page cannot change this
// script's built-ins, so all decisions happen here, never in the page's own context.

import siteRules from '../rules/sites.json' with { type: 'json' };
import { isVisibleIn, scoreClipboard } from '../core/clipboard-score.ts';
import { hostMatches } from '../core/domains.ts';
import { BEHAVIOUR_WEIGHTS, scoreFakeAlert } from '../core/fake-alert-score.ts';
import type { ContentMessage, PageStatus } from '../core/types.ts';

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
function report(kind: 'clipboard' | 'fake-alert', reasons: string[]): void {
  const now = Date.now();
  if (now - (lastReport[kind] ?? 0) < REPORT_INTERVAL_MS) return;
  lastReport[kind] = now;
  void message({ type: 'signal', kind, reasons });
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startPageChecks, { once: true });
} else {
  startPageChecks();
}
