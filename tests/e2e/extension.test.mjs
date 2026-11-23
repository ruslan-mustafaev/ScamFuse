// Browser tests: a real Chromium with the built extension walks through the demo scenarios.
// Run with: npm run test:e2e

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveStatic } from '../../scripts/static-server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = join(root, 'dist');

let context;
let server;
let origin;
let extensionId;
let worker;
let profileDir;

async function pauseUrl() {
  return `chrome-extension://${extensionId}/pages/pause.html`;
}

async function waitForPause(page) {
  const prefix = await pauseUrl();
  await page.waitForURL((url) => url.href.startsWith(prefix), { timeout: 10_000 });
  await page.locator('h1').waitFor();
}

async function storage(area, key) {
  return worker.evaluate(
    async ([a, k]) => (await chrome.storage[a].get(k))[k],
    [area, key],
  );
}

before(async () => {
  ({ server, origin } = await serveStatic({ '/': join(root, 'demo'), '/fixtures/': join(root, 'tests/e2e/fixtures') }));
  profileDir = await mkdtemp(join(tmpdir(), 'scamfuse-e2e-'));
  context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    locale: 'en-US',
    acceptDownloads: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
});

after(async () => {
  await context?.close();
  server?.close();
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
});

test('setup opens by itself and takes two clicks', async () => {
  const welcomeUrl = `chrome-extension://${extensionId}/pages/welcome.html`;
  let page = context.pages().find((p) => p.url().startsWith(welcomeUrl));
  if (!page) page = await context.waitForEvent('page', { predicate: (p) => p.url().startsWith(welcomeUrl), timeout: 10_000 });

  await page.locator('[data-profile="elder"]').click(); // click 1
  await page.locator('#who').fill('Dad');
  await page.locator('#phone').fill('+421 900 123 456');
  await page.locator('#enable').click(); // click 2
  await page.locator('#done').waitFor();

  const settings = await storage('local', 'settings');
  assert.equal(settings.setupDone, true);
  assert.equal(settings.profile, 'elder');
  assert.equal(settings.guardianName, 'Dad');
  assert.equal(settings.mode, 'advice');
  await page.close();
});

test('a fake "I am not a robot" check is stopped and the command is removed', async () => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const page = await context.newPage();
  await page.goto(`${origin}/clickfix.html?lang=en`);
  await page.locator('#robot').click(); // the page turns into the pause screen, so no checked-state wait
  await waitForPause(page);

  assert.equal(await page.locator('h1').textContent(), "Stop. Let's check.");
  const ask = page.locator('#ask');
  assert.equal(await ask.textContent(), 'Ask Dad');
  const href = await ask.getAttribute('href');
  assert.ok(href.startsWith('https://wa.me/421900123456?text='), href);
  assert.match(decodeURIComponent(href), /127\[\.\]0\[\.\]0\[\.\]1/);

  const reader = await context.newPage();
  await reader.goto(`${origin}/index.html`);
  const clipboard = await reader.evaluate(() => navigator.clipboard.readText());
  assert.doesNotMatch(clipboard, /powershell/i);
  assert.match(clipboard, /^# ScamFuse/);
  await reader.close();

  const log = await storage('local', 'log');
  assert.equal(log[0].kind, 'clipboard');
  assert.equal(log[0].host, '127.0.0.1');
  await page.close();
});

test('"Continue anyway" waits 15 seconds in advice mode, then returns to the page', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/clickfix.html?lang=en&second=1`);
  await page.locator('#robot').click(); // the page turns into the pause screen, so no checked-state wait
  await waitForPause(page);
  const button = page.locator('#continue');
  assert.equal(await button.isDisabled(), true);
  await page.waitForFunction(() => !document.querySelector('#continue')?.disabled, null, { timeout: 20_000 });
  await button.click();
  await page.waitForURL(`${origin}/clickfix.html?lang=en&second=1`, { timeout: 10_000 });

  const log = await storage('local', 'log');
  assert.equal(log[0].outcome, 'allowed');
  await page.close();
});

test('a fake virus alert is stopped and "Close this page" leaves it', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/fake-alert.html?lang=en`);
  await waitForPause(page);
  assert.match(await page.locator('main').textContent(), /pretends your computer is infected/);
  await page.locator('#close').click();
  await page.waitForURL((url) => !url.href.startsWith('chrome-extension://'), { timeout: 10_000 });
  const log = await storage('local', 'log');
  assert.equal(log[0].kind, 'fake-alert');
  assert.equal(log[0].outcome, 'blocked');
  await page.close();
});

test('a Russian fake alert is recognised too', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/fake-alert.html?lang=ru&ru=1`);
  await waitForPause(page);
  await page.close();
});

test('a remote access download is paused and can be cancelled', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/index.html?lang=en`);
  const pausePage = context.waitForEvent('page', { predicate: (p) => p.url().includes('/pages/pause.html'), timeout: 10_000 });
  await page.locator('#download-remote').click();
  const pause = await pausePage;
  await pause.locator('h1').waitFor();
  assert.match(await pause.locator('#close').textContent(), /Cancel the download/);
  await pause.locator('#close').click();
  await pause.waitForEvent('close', { timeout: 10_000 });

  const downloads = await worker.evaluate(() => chrome.downloads.search({ filenameRegex: 'ScamFuse-Demo' }));
  assert.ok(downloads.every((item) => item.state !== 'complete' || !item.exists), JSON.stringify(downloads));
  const log = await storage('local', 'log');
  assert.equal(log[0].kind, 'remote-download');
  assert.equal(log[0].outcome, 'blocked');
  await page.close();
});

test('a visible command copied with a copy button on a normal page is not stopped', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/fixtures/legit.html`);
  await page.locator('#copy').click();
  await page.locator('#result', { hasText: /copied|copy failed/ }).waitFor();
  await page.waitForTimeout(1500);
  assert.equal(page.url(), `${origin}/fixtures/legit.html`);
  await page.close();
});

test('programs from unofficial sites pass in the elder profile and stop in the child profile', async () => {
  const isPause = (p) => p.url().includes('/pages/pause.html');
  const pausesBefore = new Set(context.pages().filter(isPause));
  const page = await context.newPage();
  await page.goto(`${origin}/index.html?lang=en`);
  const download = page.waitForEvent('download');
  await page.locator('#download-program').click();
  await download;
  await page.waitForTimeout(1000);
  assert.equal(context.pages().some((p) => isPause(p) && !pausesBefore.has(p)), false);

  await worker.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    settings.profile = 'child';
    settings.detectors.programDownload = true;
    await chrome.storage.local.set({ settings });
  });
  const pausePage = context.waitForEvent('page', { predicate: (p) => p.url().includes('/pages/pause.html'), timeout: 10_000 });
  await page.locator('#download-program').click();
  const pause = await pausePage;
  await pause.locator('h1').waitFor();
  assert.match(await pause.locator('main').textContent(), /steal game accounts/);
  await pause.close();
  await page.close();
});

test('the pause screen follows a manual language choice', async () => {
  await worker.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    settings.language = 'ru';
    settings.profile = 'elder';
    settings.detectors.programDownload = false;
    await chrome.storage.local.set({ settings });
  });
  const page = await context.newPage();
  await page.goto(`${origin}/fake-alert.html?lang=en&lang-test=1`);
  await waitForPause(page);
  assert.equal(await page.locator('h1').textContent(), 'Стоп. Давайте проверим.');
  assert.equal(await page.locator('#ask').textContent(), 'Спросить: Dad');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'ru');
  await page.close();
});
