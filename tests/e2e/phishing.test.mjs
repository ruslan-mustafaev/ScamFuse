// Browser tests for the fake-site check.

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
let worker;
let extensionId;
let profileDir;

async function waitForPause(page) {
  const prefix = `chrome-extension://${extensionId}/pages/pause.html`;
  await page.waitForURL((url) => url.href.startsWith(prefix), { timeout: 10_000 });
  await page.locator('h1').waitFor();
}

before(async () => {
  ({ server, origin } = await serveStatic({ '/': join(root, 'demo'), '/fixtures/': join(root, 'tests/e2e/fixtures') }));
  profileDir = await mkdtemp(join(tmpdir(), 'scamfuse-phishing-e2e-'));
  context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    locale: 'en-US',
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
  await new Promise((done) => setTimeout(done, 500));
  await worker.evaluate(() =>
    chrome.storage.local.set({ settings: { setupDone: true, profile: 'elder', guardianName: 'Dad', guardianPhone: '+421 900 123 456', language: 'en' } }),
  );
});

after(async () => {
  await context?.close();
  server?.close();
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
});

test('a fake bank login is stopped as soon as it opens, naming the brand', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/fake-login.html?lang=en`);
  await waitForPause(page);
  assert.match(await page.locator('main').textContent(), /pretends to be ScamFuse Demo Bank/);
  await page.locator('details summary').click();
  const reasons = await page.locator('details').textContent();
  assert.match(reasons, /pretends to be a known brand/);
  assert.match(reasons, /Typical phishing phrases/);
  const log = await worker.evaluate(async () => (await chrome.storage.local.get('log')).log);
  assert.equal(log[0].kind, 'phishing');
  await page.close();
});

test('a suspicious page is paused before the password is typed', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/fixtures/suspicious-login.html`);
  await page.waitForTimeout(1200);
  assert.equal(page.url(), `${origin}/fixtures/suspicious-login.html`, 'not stopped just for opening');
  await page.locator('#password').click();
  await waitForPause(page);
  assert.match(await page.locator('main').textContent(), /has signs of a fake page/);
  await page.close();
});

test('a normal shop login with "Sign in with Google" is not touched', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/fixtures/shop-login.html`);
  await page.locator('#password').click();
  await page.locator('#password').fill('secret');
  await page.waitForTimeout(1200);
  assert.equal(page.url(), `${origin}/fixtures/shop-login.html`);
  await page.close();
});

test('the toolbar window shows the page check result', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/fixtures/suspicious-login.html?popup=1`);
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url })).at(0)?.id, `${origin}/fixtures/suspicious-login.html?popup=1`);
  const check = await worker.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'siteCheck' }, { frameId: 0 }), tabId);
  assert.equal(check.level, 'medium');
  assert.ok(check.reasons.includes('phishing-words'));
  await page.close();
});
