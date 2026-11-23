import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreFakeAlert } from '../../extension/src/core/fake-alert-score.ts';

const SCAM_EN =
  'Windows Defender Security Alert. Your computer has been blocked. Virus infected: Trojan spyware detected. ' +
  'Do not restart your computer. Call Microsoft Support: +1-800-555-0199 (toll free).';

const SCAM_RU =
  'Предупреждение безопасности! Ваш компьютер заблокирован. Обнаружен вирус и троян. ' +
  'Не перезагружайте компьютер. Позвоните в службу поддержки: 8 800 555-01-99.';

test('a short scam page with a support number is stopped', () => {
  assert.equal(scoreFakeAlert({ text: SCAM_EN, title: 'Security Alert', behaviour: new Set() }).high, true);
  assert.equal(scoreFakeAlert({ text: SCAM_RU, title: 'Внимание', behaviour: new Set() }).high, true);
});

test('trap behaviour plus a phone number is stopped even with few words', () => {
  const verdict = scoreFakeAlert({
    text: 'Error. Call now: +1 (888) 555-0142',
    title: '',
    behaviour: new Set(['fullscreen', 'history-trap']),
  });
  assert.equal(verdict.high, true);
});

test('a long news article about scams is not stopped', () => {
  const article =
    'How tech support scams work. Scammers show messages like "Your computer has been blocked. ' +
    'Call Microsoft support at 1-800-555-0199". Here is how to stay safe. ' +
    'Lorem ipsum dolor sit amet. '.repeat(200);
  const verdict = scoreFakeAlert({ text: article, title: 'How tech support scams work', behaviour: new Set() });
  assert.equal(verdict.high, false);
});

test('a page that only goes full screen (a video player) is not stopped', () => {
  const verdict = scoreFakeAlert({
    text: 'Watch the trailer. 2:31',
    title: 'Trailer',
    behaviour: new Set(['fullscreen']),
  });
  assert.equal(verdict.high, false);
});

test('a support page with a phone number but no alarm words is not stopped', () => {
  const verdict = scoreFakeAlert({
    text: 'Customer service: call 1-800-555-0100, Monday to Friday.',
    title: 'Contact us',
    behaviour: new Set(),
  });
  assert.equal(verdict.high, false);
});
