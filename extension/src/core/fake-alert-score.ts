// Scores a page for the signs of a fake virus alert (tech support scam).
//
// Words alone are not enough: news articles about scams use the same words.
// A page is stopped when it also behaves like a trap (full screen, keyboard lock,
// dialog loops, back-button trap) or when it is a short page built around a phone number.

import en from '../rules/dictionaries/en.json' with { type: 'json' };
import ru from '../rules/dictionaries/ru.json' with { type: 'json' };
import type { Verdict } from './types.ts';

export interface Dictionary {
  language: string;
  words: string[];
  strong: string[];
}

export const DICTIONARIES: readonly Dictionary[] = [en, ru];

/** Behaviour signals reported by the page hooks, with their weight. */
export const BEHAVIOUR_WEIGHTS: Readonly<Record<string, number>> = {
  fullscreen: 2,
  'keyboard-lock': 3,
  'dialog-loop': 2,
  'history-trap': 2,
};

const TOLL_FREE =
  /(\+?1[\s.-]?)?\(?8(00|33|44|55|66|77|88)\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|\b0?800[\s-]?\d{3}[\s-]?\d{3,4}\b|\b8[\s(-]*800[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b/;
const CALL_NUMBER =
  /(call|dial|phone|contact|позвоните|звоните|позвонить|телефон)[^0-9+]{0,40}\+?\d[\d\s().-]{8,}\d/i;

const SHORT_PAGE = 4000;

export interface FakeAlertInput {
  text: string;
  title: string;
  behaviour: ReadonlySet<string>;
  dictionaries?: readonly Dictionary[];
}

function countMatches(haystack: string, phrases: readonly string[]): number {
  let count = 0;
  for (const phrase of phrases) if (haystack.includes(phrase)) count += 1;
  return count;
}

export function scoreFakeAlert(input: FakeAlertInput): Verdict & { words: number; behaviour: number; phone: boolean } {
  const dictionaries = input.dictionaries ?? DICTIONARIES;
  const text = input.text.slice(0, 20000).toLowerCase();
  const title = input.title.toLowerCase();
  const reasons: string[] = [];

  let wordCount = 0;
  let strongCount = 0;
  let titleHit = false;
  for (const dictionary of dictionaries) {
    wordCount += countMatches(text, dictionary.words);
    strongCount += countMatches(text, dictionary.strong);
    if (!titleHit && (countMatches(title, dictionary.words) || countMatches(title, dictionary.strong))) {
      titleHit = true;
    }
  }
  const words = Math.min(wordCount, 4) + Math.min(strongCount * 2, 4) + (titleHit ? 1 : 0);
  if (words > 0) reasons.push(`words:${words}`);

  const phone = TOLL_FREE.test(text) || CALL_NUMBER.test(text);
  if (phone) reasons.push('support-number');

  let behaviour = 0;
  for (const signal of input.behaviour) {
    const weight = BEHAVIOUR_WEIGHTS[signal];
    if (weight) {
      behaviour += weight;
      reasons.push(signal);
    }
  }

  const score = words + (phone ? 2 : 0) + behaviour;
  const short = text.length < SHORT_PAGE;
  const high =
    (behaviour >= 2 && (phone || words >= 3)) || (phone && words >= 5 && short);
  return { score, words, behaviour, phone, high, reasons };
}
