import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { daily, handle } from '../../relay/src/app.ts';
import type { Deps } from '../../relay/src/types.ts';
import { fakeTelegram, type FakeTelegram } from '../../relay/dev/fake-telegram.ts';
import { sqliteD1 } from '../../relay/dev/sqlite-d1.ts';

const MIGRATION = join(import.meta.dirname, '../../relay/migrations/0001_init.sql');
const SECRET = 'webhook-secret-123';
const BASE = 'https://relay.test';
const GUARDIAN = 5001;

function setup() {
  let clock = Date.UTC(2026, 10, 23, 12, 0, 0);
  const telegram = fakeTelegram();
  const deps: Deps = {
    db: sqliteD1(':memory:', [MIGRATION]),
    telegram,
    botUsername: 'ScamFuseBot',
    webhookSecret: SECRET,
    now: () => clock,
  };
  const install = {
    installId: 'a'.repeat(32),
    secret: 'S'.repeat(43),
    uninstallToken: 'U'.repeat(43),
  };
  const auth = { authorization: `Bearer ${install.installId}:${install.secret}` };
  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = auth) {
    const response = await handle(
      new Request(`${BASE}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      deps,
    );
    const text = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = { text };
    }
    return { status: response.status, data };
  }
  async function telegramUpdate(update: unknown) {
    return call('POST', '/telegram/webhook', update, { 'x-telegram-bot-api-secret-token': SECRET });
  }
  function message(text: string, extra: Record<string, unknown> = {}) {
    return {
      message: {
        message_id: Math.floor(Math.random() * 1e6),
        chat: { id: GUARDIAN, type: 'private' },
        from: { id: GUARDIAN, first_name: 'Ruslan', language_code: 'ru' },
        text,
        ...extra,
      },
    };
  }
  return {
    deps,
    telegram: telegram as FakeTelegram,
    install,
    call,
    telegramUpdate,
    message,
    advance(ms: number) {
      clock += ms;
    },
  };
}

async function registered() {
  const ctx = setup();
  const result = await ctx.call('POST', '/v1/installs', { ...ctx.install, name: 'Мама, ноутбук', language: 'ru', timeZone: 'Europe/Moscow' }, {});
  assert.equal(result.status, 201);
  return ctx;
}

async function paired() {
  const ctx = await registered();
  const pairing = await ctx.call('POST', '/v1/pairings');
  assert.equal(pairing.status, 201);
  const code = String(pairing.data.code);
  assert.match(code, /^\d{8}$/);
  assert.equal(pairing.data.link, `https://t.me/ScamFuseBot?start=${code}`);
  await ctx.telegramUpdate(ctx.message(`/start ${code}`));
  return { ...ctx, code };
}

test('registration needs well-formed secrets and cannot overwrite an install', async () => {
  const ctx = setup();
  assert.equal((await ctx.call('POST', '/v1/installs', { installId: 'x', secret: 'y', uninstallToken: 'z' }, {})).status, 400);
  assert.equal((await ctx.call('POST', '/v1/installs', ctx.install, {})).status, 201);
  assert.equal((await ctx.call('POST', '/v1/installs', ctx.install, {})).status, 409);
});

test('requests without the right secret are refused', async () => {
  const ctx = await registered();
  const wrong = { authorization: `Bearer ${ctx.install.installId}:${'W'.repeat(43)}` };
  assert.equal((await ctx.call('GET', '/v1/installs/me', undefined, wrong)).status, 401);
  assert.equal((await ctx.call('GET', '/v1/installs/me', undefined, {})).status, 401);
  assert.equal((await ctx.call('GET', '/v1/installs/me')).status, 200);
});

test('the Telegram webhook rejects calls without the secret header', async () => {
  const ctx = setup();
  const result = await ctx.call('POST', '/telegram/webhook', { message: {} }, { 'x-telegram-bot-api-secret-token': 'nope' });
  assert.equal(result.status, 403);
});

test('a trusted person links a chat with the code, once', async () => {
  const ctx = await paired();
  const status = await ctx.call('GET', `/v1/pairings/${ctx.code}`);
  assert.deepEqual(status.data, { ok: true, status: 'paired', guardianName: 'Ruslan' });
  assert.match(ctx.telegram.lastTo(GUARDIAN)?.text ?? '', /Подключено: Мама, ноутбук/);
  const me = await ctx.call('GET', '/v1/installs/me');
  assert.deepEqual(me.data.guardians, [{ name: 'Ruslan' }]);

  // Someone else cannot reuse the code.
  await ctx.telegramUpdate({ message: { message_id: 1, chat: { id: 777, type: 'private' }, from: { id: 777 }, text: `/start ${ctx.code}` } });
  assert.match(ctx.telegram.lastTo(777)?.text ?? '', /expired/);
});

test('an expired code does not link', async () => {
  const ctx = await registered();
  const code = String((await ctx.call('POST', '/v1/pairings')).data.code);
  ctx.advance(11 * 60_000);
  assert.equal((await ctx.call('GET', `/v1/pairings/${code}`)).data.status, 'expired');
  await ctx.telegramUpdate(ctx.message(code));
  assert.match(ctx.telegram.lastTo(GUARDIAN)?.text ?? '', /истёк/);
});

test('an alert reaches the trusted person with buttons and the unlock code, without a clickable site', async () => {
  const ctx = await paired();
  const result = await ctx.call('POST', '/v1/alerts', { kind: 'remote-download', host: 'anydesk.com', code: '483920' });
  assert.equal(result.status, 201);
  assert.equal(result.data.delivered, 1);
  const message = ctx.telegram.lastTo(GUARDIAN);
  assert.ok(message);
  assert.match(message.text, /Мама, ноутбук: попытка установить программу удалённого доступа/);
  assert.match(message.text, /anydesk\[\.\]com/);
  assert.match(message.text, /15:00 \(по часам устройства\)/, 'Moscow time');
  assert.match(message.text, /483 920/);
  assert.equal(message.keyboard?.[0]?.[0]?.callback_data, `d:${result.data.id}:a`);
});

test('the first decision wins, every message is updated, and the extension can read it', async () => {
  const ctx = await paired();
  const alert = await ctx.call('POST', '/v1/alerts', { kind: 'clipboard', host: 'evil.example' });
  const id = String(alert.data.id);
  assert.equal((await ctx.call('GET', `/v1/alerts/${id}`)).data.status, 'pending');

  const sent = ctx.telegram.lastTo(GUARDIAN);
  const callback = (data: string, cbId: string) => ({
    callback_query: { id: cbId, from: { id: GUARDIAN, first_name: 'Ruslan' }, data, message: { message_id: sent?.messageId, chat: { id: GUARDIAN, type: 'private' } } },
  });
  await ctx.telegramUpdate(callback(`d:${id}:b`, 'cb1'));
  await ctx.telegramUpdate(callback(`d:${id}:a`, 'cb2'));

  const status = await ctx.call('GET', `/v1/alerts/${id}`);
  assert.equal(status.data.status, 'blocked');
  assert.equal(status.data.decidedBy, 'Ruslan');
  assert.match(sent?.edits[0] ?? '', /Решено: не разрешать — Ruslan/);
  assert.equal(ctx.telegram.answers.at(-1)?.text, 'Уже решено');
});

test('a stranger cannot press the buttons of someone else’s alert', async () => {
  const ctx = await paired();
  const id = String((await ctx.call('POST', '/v1/alerts', { kind: 'fake-alert', host: 'x.test' })).data.id);
  await ctx.telegramUpdate({ callback_query: { id: 'x', from: { id: 999 }, data: `d:${id}:a`, message: { message_id: 1, chat: { id: 999, type: 'private' } } } });
  assert.equal((await ctx.call('GET', `/v1/alerts/${id}`)).data.status, 'pending');
});

test('a reply to the alert is passed to the pause screen', async () => {
  const ctx = await paired();
  const id = String((await ctx.call('POST', '/v1/alerts', { kind: 'fake-alert', host: 'x.test' })).data.id);
  const sent = ctx.telegram.lastTo(GUARDIAN);
  await ctx.telegramUpdate(ctx.message('Ничего не нажимай, сейчас позвоню', { reply_to_message: { message_id: sent?.messageId } }));
  const status = await ctx.call('GET', `/v1/alerts/${id}`);
  assert.equal(status.data.reply, 'Ничего не нажимай, сейчас позвоню');
  assert.equal(status.data.replyBy, 'Ruslan');
});

test('alerts without a linked person are refused, and alerts are limited to 20 a day', async () => {
  const ctx = await registered();
  assert.equal((await ctx.call('POST', '/v1/alerts', { kind: 'clipboard' })).status, 409);
  const linked = await paired();
  for (let i = 0; i < 20; i += 1) assert.equal((await linked.call('POST', '/v1/alerts', { kind: 'clipboard' })).status, 201);
  assert.equal((await linked.call('POST', '/v1/alerts', { kind: 'clipboard' })).status, 429);
});

test('removing the extension tells the trusted person', async () => {
  const ctx = await paired();
  const wrong = await ctx.call('GET', `/u?i=${ctx.install.installId}&t=${'X'.repeat(43)}`, undefined, {});
  assert.equal(wrong.status, 200);
  assert.doesNotMatch(ctx.telegram.lastTo(GUARDIAN)?.text ?? '', /удалён/);
  const page = await ctx.call('GET', `/u?i=${ctx.install.installId}&t=${ctx.install.uninstallToken}`, undefined, {});
  assert.match(String(page.data.text), /ScamFuse удалён/);
  assert.match(ctx.telegram.lastTo(GUARDIAN)?.text ?? '', /ScamFuse удалён с «Мама, ноутбук»/);
  assert.equal((await ctx.call('GET', '/v1/installs/me')).status, 401, 'a removed install is closed');
});

test('a computer silent for 7 days is reported once', async () => {
  const ctx = await paired();
  ctx.advance(8 * 24 * 60 * 60_000);
  await daily(ctx.deps);
  await daily(ctx.deps);
  const silent = ctx.telegram.sent.filter((m) => /не выходит на связь/.test(m.text));
  assert.equal(silent.length, 1);
  await ctx.call('POST', '/v1/heartbeat');
  ctx.advance(8 * 24 * 60 * 60_000);
  await daily(ctx.deps);
  assert.equal(ctx.telegram.sent.filter((m) => /не выходит на связь/.test(m.text)).length, 2);
});

test('switching protection off is reported; unknown events are refused', async () => {
  const ctx = await paired();
  assert.equal((await ctx.call('POST', '/v1/events', { type: 'disabled' })).data.delivered, 1);
  assert.match(ctx.telegram.lastTo(GUARDIAN)?.text ?? '', /выключили защиту/);
  assert.equal((await ctx.call('POST', '/v1/events', { type: 'whatever' })).status, 400);
});

test('/stop unlinks the chat and /lang switches the bot language', async () => {
  const ctx = await paired();
  await ctx.telegramUpdate({ callback_query: { id: 'l', from: { id: GUARDIAN }, data: 'l:en', message: { message_id: 1, chat: { id: GUARDIAN, type: 'private' } } } });
  await ctx.call('POST', '/v1/test');
  assert.match(ctx.telegram.lastTo(GUARDIAN)?.text ?? '', /test alert/);
  await ctx.telegramUpdate(ctx.message('/stop'));
  assert.equal((await ctx.call('POST', '/v1/alerts', { kind: 'clipboard' })).status, 409);
});

test('setup registers the webhook only with the secret key', async () => {
  const ctx = setup();
  assert.equal((await ctx.call('GET', '/setup?key=wrong', undefined, {})).status, 403);
  const ok = await ctx.call('GET', `/setup?key=${SECRET}`, undefined, {});
  assert.equal(ok.data.webhook, `${BASE}/telegram/webhook`);
});
