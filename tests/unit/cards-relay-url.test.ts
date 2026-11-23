import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCardField, looksLikeCardNumber, luhnValid } from '../../extension/src/core/cards.ts';
import { normalizeRelayUrl, normalizeSettings } from '../../extension/src/core/settings.ts';

const noHints = { autocomplete: '', name: '', id: '', placeholder: '', label: '' };

test('card numbers are recognised by the Luhn check, other long numbers are not', () => {
  assert.equal(luhnValid('4111111111111111'), true);
  assert.equal(looksLikeCardNumber('4111 1111 1111 1111'), true);
  assert.equal(looksLikeCardNumber('5555-5555-5555-4444'), true);
  assert.equal(looksLikeCardNumber('4111111111111112'), false);
  assert.equal(looksLikeCardNumber('123456'), false);
  assert.equal(looksLikeCardNumber('+421 900 123 456'), false);
});

test('card fields are recognised by their attributes in several languages', () => {
  assert.equal(isCardField({ ...noHints, autocomplete: 'cc-number' }), true);
  assert.equal(isCardField({ ...noHints, name: 'cardNumber' }), true);
  assert.equal(isCardField({ ...noHints, placeholder: 'Номер карты' }), true);
  assert.equal(isCardField({ ...noHints, label: 'Kartennummer' }), true);
  assert.equal(isCardField({ ...noHints, name: 'email' }), false);
  assert.equal(isCardField({ ...noHints, name: 'phone_number' }), false);
});

test('the relay address must be https, except a relay on this computer', () => {
  assert.equal(normalizeRelayUrl('https://scamfuse-relay.example.workers.dev/'), 'https://scamfuse-relay.example.workers.dev');
  assert.equal(normalizeRelayUrl('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  assert.equal(normalizeRelayUrl('http://evil.example'), '');
  assert.equal(normalizeRelayUrl('https://x.example/?a=1'), '');
  assert.equal(normalizeRelayUrl('javascript:alert(1)'), '');
  assert.equal(normalizeSettings({ relayUrl: 'ftp://x' }).relayUrl, '');
});

test('new checks have the right defaults per profile', () => {
  assert.equal(normalizeSettings({ profile: 'child' }).detectors.cardEntry, true);
  assert.equal(normalizeSettings({ profile: 'elder' }).detectors.cardEntry, false);
  assert.equal(normalizeSettings({ profile: 'elder' }).detectors.screenShare, true);
});
