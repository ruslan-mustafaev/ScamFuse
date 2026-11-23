// Scores text that a page puts into the clipboard ("ClickFix" / fake CAPTCHA attacks).
//
// The attack: a page writes a command into the clipboard and tells the person to press
// Win+R (or open Terminal), paste and press Enter. Two groups of signals are scored:
// how much the text looks like a command, and how much the page looks like a trick.

import type { Verdict } from './types.ts';

type Signal = readonly [RegExp, number, string];

const MAX_TEXT = 5000;
const MAX_PAGE_TEXT = 20000;

/** Signs that the text is a command for the system shell. */
const COMMAND_SIGNALS: readonly Signal[] = [
  [/\bpowershell(\.exe)?\b|\bpwsh\b/i, 3, 'powershell'],
  [/\bcmd(\.exe)?["']?\s+\/[ckr]\b/i, 3, 'cmd'],
  [/\bmshta(\.exe)?\b/i, 4, 'mshta'],
  [/\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/i, 4, 'pipe-to-shell'],
  [/\b(ba|z)?sh\s+-c\b/i, 2, 'shell-c'],
  [/\bosascript\b/i, 3, 'osascript'],
  [/\bmsiexec(\.exe)?\b/i, 3, 'msiexec'],
  [/\b(iex|invoke-expression|irm|iwr|invoke-restmethod|invoke-webrequest)\b/i, 3, 'download-run'],
  [/(^|\s)-e(nc(odedcommand)?)?\s+[a-z0-9+/=]{20,}/i, 3, 'encoded'],
  [/(^|\s)-w(indowstyle)?\s+h(id(den)?)?\b/i, 3, 'hidden-window'],
  [/\b(rundll32|regsvr32|certutil|bitsadmin|wscript|cscript|forfiles|conhost|curl\.exe)\b/i, 3, 'system-tool'],
  [/frombase64string|\bbase64\s+(-d|--decode|-D)\b/i, 3, 'base64-decode'],
  [/start-process|new-object\s+(system\.)?net\.webclient|downloadstring|downloadfile/i, 3, 'download-api'],
  [/\bchmod\s+\+x\b|\bxattr\s+-[cdr]/i, 2, 'unix-exec-prep'],
  [/https?:\/\/|\b\d{1,3}(\.\d{1,3}){3}\b/i, 1, 'network-address'],
];

/** Signs inside the text that it is meant to fool the person who pastes it. */
const TEXT_TRICKS: readonly Signal[] = [
  // ClickFix appends a comment so the Run box shows only "I am not a robot ...".
  [/#.{0,80}(robot|captcha|verif|human|ray id|робот|провер|человек)/i, 3, 'fake-verification-comment'],
  [/\s{40,}/, 2, 'hidden-padding'],
];

/** Signs on the page itself. */
const PAGE_TRICKS: readonly Signal[] = [
  [
    /(win(dows)?\s*(key|logo)?\s*\+\s*[rx]\b|⊞\s*\+?\s*[rx]\b|press\s+(the\s+)?windows|run\s+dialog|cmd\s*\+\s*space|open\s+(the\s+)?terminal|paste\s+.{0,40}(enter|terminal)|ctrl\s*\+\s*v.{0,40}enter|нажмите\s+.{0,10}win|клавиш[уиа]\s+win|окно\s+«?выполнить|откройте\s+терминал|вставьте\s+.{0,40}(enter|терминал))/i,
    2,
    'run-instructions',
  ],
  [
    /(i'?m\s+not\s+a\s+robot|i\s+am\s+not\s+a\s+robot|verify\s+(that\s+)?you\s+are\s+(a\s+)?human|human\s+verification|verification\s+steps|я\s+не\s+робот|подтвердите,?\s+что\s+вы\s+(не\s+робот|человек))/i,
    2,
    'fake-captcha',
  ],
];

export interface ClipboardInput {
  text: string;
  /** The page wrote the text with a script (not the person copying a selection). */
  scriptWritten: boolean;
  /** The text (or its start) can be seen on the page. */
  visibleOnPage: boolean;
  /** Visible text of the page. */
  pageText: string;
}

function apply(signals: readonly Signal[], text: string, reasons: string[]): number {
  let score = 0;
  for (const [pattern, weight, reason] of signals) {
    if (pattern.test(text)) {
      score += weight;
      reasons.push(reason);
    }
  }
  return score;
}

export function scoreClipboard(input: ClipboardInput): Verdict & { command: number; trick: number } {
  const text = input.text.slice(0, MAX_TEXT);
  const reasons: string[] = [];
  const command = apply(COMMAND_SIGNALS, text, reasons);
  let trick = apply(TEXT_TRICKS, text, reasons);
  if (command > 0) {
    if (input.scriptWritten && !input.visibleOnPage) {
      trick += 3;
      reasons.push('hidden-write');
    }
    trick += apply(PAGE_TRICKS, input.pageText.slice(0, MAX_PAGE_TEXT), reasons);
  }
  const high = (command >= 3 && trick >= 2) || command >= 8;
  return { score: command + trick, command, trick, high, reasons };
}

/** Collapses whitespace so text copied from the page can be compared with what is visible. */
export function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** True when the first 80 characters of the text appear in the visible page text. */
export function isVisibleIn(text: string, pageText: string): boolean {
  const probe = normalizeForCompare(text).slice(0, 80);
  if (!probe) return true;
  return normalizeForCompare(pageText).includes(probe);
}
