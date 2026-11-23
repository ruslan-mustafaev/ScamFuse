// Browser tests with the alert relay: Chromium with the extension, a local relay, a simulated Telegram.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveStatic } from '../../scripts/static-server.mjs';
import { startLocalRelay } from '../../scripts/relay-local.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = join(root, 'dist');
const GUARDIAN = 5001;

let context;
let server;
let origin;
let relay;
let worker;
let extensionId;
let profileDir;

function guardianMessage(text, extra = {}) {
  return {
    message: {
      message_id: Math.floor(Math.random() * 1e6),
      chat: { id: GUARDIAN, type: 'private' },
      from: { id: GUARDIAN, first_name: 'Ruslan', language_code: 'en' },
      text,
      ...extra,
    },
  };
}

function press(alertMessage, choice) {
  const button = alertMessage.keyboard.flat().find((b) => b.callback_data.endsWith(`:${choice}`));
  return {
    callback_query: {
      id: `cb${Math.random()}`,
      from: { id: GUARDIAN, first_name: 'Ruslan' },
      data: button.callback_data,
      message: { message_id: alertMessage.messageId, chat: { id: GUARDIAN, type: 'private' } },
    },
  };
}

async function lastAlert(pattern) {
  for (let i = 0; i < 50; i += 1) {
    const message = relay.telegram.lastTo(GUARDIAN);
    if (message && pattern.test(message.text)) return message;
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`No Telegram message matching ${pattern}: ${relay.telegram.lastTo(GUARDIAN)?.text}`);
}

async function waitForPause(page) {
  const prefix = `chrome-extension://${extensionId}/pages/pause.html`;
  await page.waitForURL((url) => url.href.startsWith(prefix), { timeout: 10_000 });
  await page.locator('h1').waitFor();
}

async function patchSettings(patch) {
  await worker.evaluate(async (p) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, ...p, detectors: { ...settings.detectors, ...(p.detectors ?? {}) } } });
  }, patch);
}

before(async () => {
  relay = await startLocalRelay();
  ({ server, origin } = await serveStatic({ '/': join(root, 'demo'), '/fixtures/': join(root, 'tests/e2e/fixtures') }));
  profileDir = await mkdtemp(join(tmpdir(), 'scamfuse-relay-e2e-'));
  context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    locale: 'en-US',
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
  await new Promise((done) => setTimeout(done, 500));
  await worker.evaluate(async (relayUrl) => {
    await chrome.storage.local.set({
      settings: {
        setupDone: true,
        profile: 'elder',
        guardianName: 'Dad',
        guardianPhone: '+421 900 123 456',
        channel: 'whatsapp',
        relayUrl,
        installName: 'Mom, laptop',
        language: 'en',
      },
    });
  }, relay.origin);
});

after(async () => {
  await context?.close();
  server?.close();
  await relay?.close();
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
});

test('the trusted person links Telegram with the code from the QR screen', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/pages/options.html`);
  await page.locator('#tg-connect').click();
  const qr = page.locator('.qr');
  await qr.waitFor();
  const code = await qr.getAttribute('data-code');
  assert.match(code, /^\d{8}$/);
  assert.equal(await page.locator('.qr svg path').count(), 1);

  await relay.telegramUpdate(guardianMessage(`/start ${code}`));
  await page.locator('#tg-linked').waitFor({ timeout: 10_000 });
  assert.equal(await page.locator('#tg-linked').textContent(), 'Connected: Ruslan');
  assert.match(relay.telegram.lastTo(GUARDIAN).text, /Linked: Mom, laptop/);

  await page.locator('#tg-test').click();
  await lastAlert(/Mom, laptop: test alert/);
  await page.close();
});

test('a stopped command reaches Telegram by itself, the reply shows up, and the code unlocks', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/clickfix.html?lang=en`);
  await page.locator('#robot').click(); // the page turns into the pause screen, so no checked-state wait
  await waitForPause(page);

  const alert = await lastAlert(/Mom, laptop: a site slipped a command into the clipboard/);
  assert.match(alert.text, /127\[\.\]0\[\.\]0\[\.\]1/);
  const code = /Code to unlock by phone: (\d{3}) (\d{3})/.exec(alert.text);
  assert.ok(code, alert.text);
  await page.locator('#relay-sent').waitFor({ timeout: 10_000 });
  assert.match(await page.locator('#relay-sent').textContent(), /Message sent to Ruslan/);
  assert.equal(await page.locator('#ask').textContent(), 'Message sent');

  await relay.telegramUpdate(guardianMessage('Do not paste anything, I am calling you', { reply_to_message: { message_id: alert.messageId } }));
  await page.locator('#relay-reply').waitFor({ timeout: 10_000 });
  assert.equal(await page.locator('#relay-reply').textContent(), 'Ruslan: “Do not paste anything, I am calling you”');

  await page.locator('#code').fill('000000');
  await page.locator('#code-open').click();
  await page.locator('text=Wrong code').waitFor();
  await page.locator('#code').fill(`${code[1]}${code[2]}`);
  await page.locator('#code-open').click();
  await page.waitForURL(`${origin}/clickfix.html?lang=en`, { timeout: 10_000 });
  await page.close();
});

test('"Don\'t allow" in Telegram appears on the pause screen', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/fake-alert.html?lang=en`);
  await waitForPause(page);
  const alert = await lastAlert(/fake virus alert/);
  await relay.telegramUpdate(press(alert, 'b'));
  await page.locator('#relay-decision').waitFor({ timeout: 10_000 });
  assert.equal(await page.locator('#relay-decision').textContent(), 'Ruslan: not allowed. You can close this page.');
  assert.equal(await page.locator('#continue').isHidden(), true);
  const edited = relay.telegram.sent.find((m) => m.messageId === alert.messageId);
  assert.match(edited.edits.at(-1), /Decision: not allowed — Ruslan/);
  await page.locator('#close').click();
  await page.waitForURL((url) => !url.href.startsWith('chrome-extension://'), { timeout: 10_000 });
  await page.close();
});

test('screen sharing is refused, paused, and "Allow" in Telegram returns the person', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/fixtures/screen.html`);
  await page.locator('#share').click();
  await waitForPause(page);
  assert.match(await page.locator('main').textContent(), /asks to see your screen/);
  const alert = await lastAlert(/asks to share the screen/);
  await relay.telegramUpdate(press(alert, 'a'));
  await page.waitForURL(`${origin}/fixtures/screen.html`, { timeout: 10_000 });
  await page.close();
});

test('in the child profile, typing a card number pauses the purchase', async () => {
  await patchSettings({ profile: 'child', detectors: { cardEntry: true, programDownload: true } });
  const page = await context.newPage();
  await page.goto(`${origin}/fixtures/shop.html`);
  await page.locator('#card').pressSequentially('4111', { delay: 20 });
  await waitForPause(page);
  assert.match(await page.locator('main').textContent(), /bank card details/);
  await lastAlert(/bank card details are being entered/);
  await page.close();
});

test('switching protection off tells the trusted person', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/pages/options.html`);
  await page.locator('#enabled').uncheck();
  await lastAlert(/Protection was switched off on “Mom, laptop”/);
  await page.close();
});
