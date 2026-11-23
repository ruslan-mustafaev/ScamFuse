import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domainToASCII } from 'node:url';
import { decodePunycode, toUnicodeHost } from '../../extension/src/core/punycode.ts';
import {
  analyzeHost,
  editDistance,
  officialBrand,
  type PageFacts,
  scoreSite,
  skeleton,
} from '../../extension/src/core/site-risk.ts';

function codes(host: string): string[] {
  return analyzeHost(host).markers.map((m) => m.code);
}

function facts(patch: Partial<PageFacts>): PageFacts {
  return {
    host: 'example.org',
    https: true,
    title: '',
    headings: '',
    formText: '',
    hasPassword: false,
    hasCard: false,
    hasOneTimeCode: false,
    asksSeedPhrase: false,
    formActionHosts: [],
    assetHosts: [],
    telegramBot: false,
    bodyText: '',
    ...patch,
  };
}

test('international addresses are decoded the same way the browser does', () => {
  for (const name of ['pаypal.com', 'münchen.de', 'аpple.com', 'тест.укр']) {
    const ascii = domainToASCII(name);
    assert.equal(toUnicodeHost(ascii), name, ascii);
  }
  assert.equal(decodePunycode('###'), null);
});

test('look-alike letters reduce to the same shape', () => {
  assert.equal(skeleton('paypa1'), 'paypal');
  assert.equal(skeleton('рауpal'), 'paypal');
  assert.equal(skeleton('rnicrosoft'), 'microsoft');
  assert.equal(editDistance('steamcommunlty', 'steamcommunity'), 1);
  assert.equal(editDistance('paypal', 'papyal'), 1);
});

test('official sites of known brands are trusted', () => {
  for (const host of ['paypal.com', 'www.paypal.com', 'login.microsoftonline.com', 'accounts.google.com', 'google.de', 'steamcommunity.com', 'ib.tatrabanka.sk', 'privat24.ua']) {
    assert.ok(officialBrand(host), host);
    assert.deepEqual(codes(host), [], host);
  }
  assert.equal(officialBrand('google.tk'), null, 'free country domains are not trusted');
});

test('fake addresses are recognised by their trick', () => {
  assert.ok(codes('paypa1.com').includes('homoglyph'));
  assert.ok(codes(domainToASCII('pаypal.com')).includes('mixed-script'));
  assert.ok(codes(domainToASCII('pаypal.com')).includes('homoglyph'));
  assert.ok(codes('steamcommunlty.com').includes('lookalike'));
  assert.ok(codes('steamcornmunity.com').includes('homoglyph'));
  assert.ok(codes('netfiix.com').includes('lookalike'));
  assert.ok(codes('paypal-secure-login.com').includes('brand-in-domain'));
  assert.ok(codes('microsoftsupport.net').includes('brand-in-domain'));
  assert.ok(codes('micros0ft-verify.xyz').includes('brand-in-domain'));
  assert.ok(codes('tatrabanka-sk.com').includes('brand-in-domain'));
  const subdomain = codes('paypal.com.verify-account.top');
  assert.ok(subdomain.includes('brand-subdomain') && subdomain.includes('risky-tld'), subdomain.join());
  assert.ok(codes('google.tk').includes('brand-wrong-tld'));
  assert.ok(codes('paypal-login.web.app').includes('brand-in-domain'), 'brand on a free hosting subdomain');
  assert.deepEqual(codes('203.0.113.7'), ['ip-host']);
  assert.equal(analyzeHost('paypa1.com').brand?.name, 'PayPal');
});

test('ordinary addresses are not flagged', () => {
  for (const host of [
    'example.com', 'github.com', 'stream.me', 'paypay.ne.jp', 'applebees.com', 'goodreads.com', 'disney.com',
    'wikipedia.org', 'shop.example.sk', 'cooking.com', 'discard.com', 'telegraf.com', 'ledgers.com', 'bookings.com',
    'amazing.com', 'linkedin.cn', 'alza.sk', 'posta.sk', 'heureka.sk', 'skinport.com', 'steamdb.info',
  ]) {
    assert.deepEqual(codes(host), [], host);
  }
});

test('a fake login page on a look-alike address is stopped at once', () => {
  const verdict = scoreSite(
    facts({
      host: 'paypal-login.web.app',
      title: 'Log in to your PayPal account',
      headings: 'PayPal',
      formText: 'PayPal Email Password Log In',
      hasPassword: true,
      bodyText: 'Your account has been limited. Verify your account to restore access.',
    }),
  );
  assert.equal(verdict.level, 'high');
  assert.equal(verdict.brand, 'PayPal');
  assert.ok(verdict.reasons.includes('brand-content'));
});

test('a page that sends passwords to a Telegram bot is stopped', () => {
  const verdict = scoreSite(facts({ hasPassword: true, telegramBot: true, title: 'Sign in' }));
  assert.equal(verdict.level, 'high');
  assert.ok(verdict.reasons.includes('telegram-exfil'));
});

test('a wallet recovery phrase request is at least suspicious, and stopped when it imitates a wallet', () => {
  assert.equal(scoreSite(facts({ asksSeedPhrase: true, bodyText: 'Enter your 12 word recovery phrase' })).level, 'medium');
  const wallet = scoreSite(
    facts({ asksSeedPhrase: true, title: 'MetaMask - restore wallet', formText: 'MetaMask Secret Recovery Phrase', bodyText: 'Connect your wallet' }),
  );
  assert.equal(wallet.level, 'high');
});

test('a normal shop login with "Sign in with Google" is not suspicious', () => {
  const verdict = scoreSite(
    facts({
      host: 'example-shop.com',
      title: 'Example Shop — Sign in',
      headings: 'Sign in',
      formText: 'Sign in to Example Shop. Email Password Sign in Sign in with Google Continue with Apple',
      hasPassword: true,
      formActionHosts: ['example-shop.com'],
      bodyText: 'Welcome back',
    }),
  );
  assert.equal(verdict.level, 'low');
  assert.deepEqual(verdict.reasons, []);
});

test('a news article about PayPal scams is not suspicious', () => {
  const verdict = scoreSite(
    facts({
      host: 'news.example.com',
      title: 'How the PayPal "account limited" scam works',
      headings: 'PayPal scam explained',
      bodyText: 'Scammers write "your account has been limited" and "verify your account".',
    }),
  );
  assert.equal(verdict.level, 'low');
});

test('the official site stays clean even with alarming words', () => {
  const verdict = scoreSite(
    facts({ host: 'www.paypal.com', title: 'PayPal', formText: 'PayPal Password', hasPassword: true, bodyText: 'unusual activity' }),
  );
  assert.equal(verdict.level, 'low');
});

test('a password sent to another site, without encryption, adds up to suspicion', () => {
  const verdict = scoreSite(
    facts({
      host: 'mail-portal.example',
      https: false,
      hasPassword: true,
      formActionHosts: ['collector.example.net'],
      bodyText: 'Your password has expired. Mailbox is full.',
    }),
  );
  assert.equal(verdict.level, 'medium');
  assert.ok(verdict.reasons.includes('foreign-form'));
  assert.ok(verdict.reasons.includes('insecure-password'));
});
