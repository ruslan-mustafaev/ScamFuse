import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAskLink, buildAskMessage, canAsk, formatPhone, telLink } from '../../extension/src/core/contact.ts';
import { defang } from '../../extension/src/core/domains.ts';
import { Translator } from '../../extension/src/core/i18n.ts';
import { hashPin, nextGuard, verifyPin } from '../../extension/src/core/pin.ts';
import {
  allow,
  appendLog,
  continueAvailableAt,
  countToday,
  findRepeat,
  isAllowed,
} from '../../extension/src/core/policy.ts';
import {
  defaultChannel,
  normalizeHostInput,
  normalizePhone,
  normalizeSettings,
} from '../../extension/src/core/settings.ts';
import type { PauseEvent } from '../../extension/src/core/types.ts';

test('settings from storage are repaired, not trusted', () => {
  const settings = normalizeSettings({ profile: 'hacker', mode: 'strict', lockMinutes: 1, detectors: { clipboard: false } });
  assert.equal(settings.profile, 'elder');
  assert.equal(settings.mode, 'advice', 'strict mode needs a PIN');
  assert.equal(settings.lockMinutes, 10);
  assert.equal(settings.detectors.clipboard, false);
  assert.equal(settings.detectors.remoteAccess, true);
});

test('the default messenger follows the language', () => {
  assert.equal(defaultChannel('ru'), 'telegram');
  assert.equal(defaultChannel('en-GB'), 'whatsapp');
});

test('phone numbers and site addresses are normalised', () => {
  assert.equal(normalizePhone('+421 900 123 456'), '421900123456');
  assert.equal(normalizePhone('00421 900 123 456'), '421900123456');
  assert.equal(normalizePhone('123'), '');
  assert.equal(normalizeHostInput('https://www.Example.com/path?q=1'), 'example.com');
  assert.equal(normalizeHostInput('not a site'), '');
});

test('chat links open a chat with one person and the text filled in', () => {
  const message = 'Hi!\nSite: evil[.]com';
  assert.equal(
    buildAskLink({ channel: 'whatsapp', phone: '+421 900 123 456', email: '' }, 's', message),
    'https://wa.me/421900123456?text=Hi!%0ASite%3A%20evil%5B.%5Dcom',
  );
  assert.equal(
    buildAskLink({ channel: 'telegram', phone: '+380 67 123 4567', email: '' }, 's', 'x'),
    'https://t.me/+380671234567?text=x',
  );
  assert.equal(
    buildAskLink({ channel: 'email', phone: '', email: 'dad@example.com' }, 'Check', 'x y'),
    'mailto:dad@example.com?subject=Check&body=x%20y',
  );
  assert.equal(buildAskLink({ channel: 'whatsapp', phone: '12', email: '' }, 's', 'x'), null);
  assert.equal(canAsk({ channel: 'email', phone: '+421900123456', email: '' }), false);
  assert.equal(telLink('+421 900 123 456'), 'tel:+421900123456');
  assert.equal(formatPhone('+380 67 123 4567'), '+380 67 123 4567');
  assert.equal(formatPhone('421900123456'), '+421900123456');
  assert.equal(formatPhone('00421 900 123 456'), '+421 900 123 456');
});

test('the message names the site in a form that messengers do not turn into a link', () => {
  const tr = new Translator('en', {
    msg_intro: { message: 'Hi!' },
    msg_what: { message: 'What: {what}' },
    msgwhat_clipboard: { message: 'a command' },
    msg_site: { message: 'Site: {host}' },
    msg_time: { message: 'Time: {time}' },
    msg_ask: { message: 'Call me.' },
  });
  const text = buildAskMessage(tr, { kind: 'clipboard', host: 'evil.example.com', at: 0, profile: 'elder' });
  assert.match(text, /Site: evil\[\.\]example\[\.\]com/);
  assert.doesNotMatch(text, /evil\.example/);
  assert.equal(defang('a.b'), 'a[.]b');
});

test('continue opens after 15 seconds in advice mode and after the lock in strict mode', () => {
  assert.equal(continueAvailableAt({ createdAt: 1000 }, 'advice', 30), 16_000);
  assert.equal(continueAvailableAt({ createdAt: 1000 }, 'strict', 30), 1000 + 30 * 60_000);
});

test('an allowed action expires after 30 minutes and covers only that kind; trusted sites cover all', () => {
  const now = 1_000_000;
  const allowances = allow({}, 'clipboard', 'example.com', now);
  assert.equal(isAllowed('example.com', 'clipboard', allowances, [], now + 29 * 60_000), true);
  assert.equal(isAllowed('example.com', 'clipboard', allowances, [], now + 31 * 60_000), false);
  assert.equal(isAllowed('example.com', 'fake-alert', allowances, [], now), false);
  assert.equal(isAllowed('shop.trusted.org', 'fake-alert', {}, ['trusted.org'], now), true);
  assert.equal(isAllowed('', 'clipboard', {}, ['trusted.org'], now), false);
});

test('the same event from the same site within 10 minutes reuses the pause', () => {
  const event: PauseEvent = {
    id: 'a', kind: 'clipboard', level: 'high', host: 'x.com', url: '', createdAt: 0, outcome: 'blocked', reasons: [],
  };
  assert.equal(findRepeat([event], 'clipboard', 'x.com', 5 * 60_000)?.id, 'a');
  assert.equal(findRepeat([event], 'clipboard', 'x.com', 11 * 60_000), undefined);
  assert.equal(findRepeat([{ ...event, outcome: 'allowed' }], 'clipboard', 'x.com', 1000), undefined);
});

test('the log keeps the newest 200 entries and counts today', () => {
  let log = appendLog([], { id: '0', at: 0, kind: 'clipboard', host: 'a', outcome: 'pending' });
  for (let i = 1; i < 250; i += 1) log = appendLog(log, { id: String(i), at: i, kind: 'clipboard', host: 'a', outcome: 'pending' });
  assert.equal(log.length, 200);
  assert.equal(log[0]?.id, '249');
  const now = Date.now();
  assert.equal(countToday([{ id: 'x', at: now, kind: 'clipboard', host: 'a', outcome: 'pending' }], now), 1);
});

test('the PIN is stored as a hash and wrong attempts lock input', async () => {
  const record = await hashPin('4821', 1000);
  assert.notEqual(record.hash, '4821');
  assert.equal(await verifyPin('4821', record), true);
  assert.equal(await verifyPin('1111', record), false);
  let guard = { fails: 0, lockedUntil: 0 };
  for (let i = 0; i < 4; i += 1) guard = nextGuard(guard, false, 0);
  assert.equal(guard.lockedUntil, 0);
  guard = nextGuard(guard, false, 0);
  assert.equal(guard.lockedUntil, 15 * 60_000);
  assert.deepEqual(nextGuard(guard, true, 0), { fails: 0, lockedUntil: 0 });
});
