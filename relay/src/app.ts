// HTTP API for the extension, the Telegram webhook, and the daily check.

import { deliverAlert, handleUpdate, notifyGuardians, type TgUpdate } from './bot.ts';
import { texts, uninstallPage } from './messages.ts';
import { MAX_GUARDIANS, Store } from './store.ts';
import type { AlertKind, Deps, DeviceEventType, InstallRow } from './types.ts';
import { cleanHost, cleanText, error, json, pairingCode, randomId, safeEqual, sha256Hex } from './util.ts';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const PAIRING_MS = 10 * MINUTE_MS;

const ALERT_KINDS: ReadonlySet<string> = new Set<AlertKind>([
  'remote-site', 'remote-download', 'clipboard', 'fake-alert', 'program-download', 'screen-share', 'card-entry', 'phishing', 'ask',
]);
const EVENT_TYPES: ReadonlySet<string> = new Set<DeviceEventType>(['disabled', 'pin-locked']);
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const INSTALL_ID = /^[a-f0-9]{32}$/;

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (text.length > 4096) return {};
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function authenticate(request: Request, store: Store): Promise<InstallRow | null> {
  const match = /^Bearer ([a-f0-9]{32}):([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') ?? '');
  if (!match?.[1] || !match[2]) return null;
  const install = await store.getInstall(match[1]);
  if (!install || install.removed_at) return null;
  return safeEqual(install.secret_hash, await sha256Hex(match[2])) ? install : null;
}

function installFields(input: Record<string, unknown>) {
  const patch: { name?: string; profile?: string; language?: string; time_zone?: string } = {};
  if (typeof input.name === 'string') patch.name = cleanText(input.name, 60);
  if (typeof input.profile === 'string' && ['elder', 'child', 'self'].includes(input.profile)) patch.profile = input.profile;
  if (typeof input.language === 'string') patch.language = cleanText(input.language, 16) || 'en';
  if (typeof input.timeZone === 'string' && /^[A-Za-z0-9_+\-/]{1,64}$/.test(input.timeZone)) patch.time_zone = input.timeZone;
  return patch;
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  const store = new Store(deps.db);
  const now = deps.now();
  const method = request.method;
  const path = url.pathname;

  if (method === 'GET' && path === '/') {
    return new Response('ScamFuse relay', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  // ---------------------------------------------------------------- Telegram
  if (method === 'POST' && path === '/telegram/webhook') {
    const secret = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
    if (!deps.webhookSecret || !safeEqual(secret, deps.webhookSecret)) return error('forbidden', 403);
    const update = (await body(request)) as TgUpdate;
    try {
      await handleUpdate(update, deps);
    } catch (cause) {
      console.error('update failed', cause);
    }
    return json({ ok: true });
  }

  // One-time setup after deploy: open /setup?key=<webhook secret> in a browser.
  if (method === 'GET' && path === '/setup') {
    if (!deps.webhookSecret || !safeEqual(url.searchParams.get('key') ?? '', deps.webhookSecret)) return error('forbidden', 403);
    const ok = await deps.telegram.setWebhook(`${url.origin}/telegram/webhook`, deps.webhookSecret);
    await deps.telegram.setCommands(texts('en').commands);
    await deps.telegram.setCommands(texts('ru').commands, 'ru');
    return json({ ok, webhook: `${url.origin}/telegram/webhook`, bot: deps.botUsername });
  }

  // ---------------------------------------------------------------- uninstall notice
  if (method === 'GET' && path === '/u') {
    const install = await store.getInstall(url.searchParams.get('i') ?? '');
    const token = url.searchParams.get('t') ?? '';
    if (install && TOKEN.test(token) && safeEqual(install.uninstall_hash, await sha256Hex(token))) {
      if (!install.removed_at) {
        await store.markRemoved(install.id, now);
        await notifyGuardians(deps, store, install, (lang) => texts(lang).removed(install.name));
      }
      return new Response(uninstallPage(install.language), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return new Response(uninstallPage('en'), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  // ---------------------------------------------------------------- registration
  if (method === 'POST' && path === '/v1/installs') {
    const input = await body(request);
    const id = String(input.installId ?? '');
    const secret = String(input.secret ?? '');
    const uninstallToken = String(input.uninstallToken ?? '');
    if (!INSTALL_ID.test(id) || !TOKEN.test(secret) || !TOKEN.test(uninstallToken)) return error('invalid', 400);
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    if (!(await store.allow(`register:${ip}`, 20, DAY_MS, now))) return error('rate-limited', 429);
    const fields = installFields(input);
    const created = await store.createInstall({
      id,
      secret_hash: await sha256Hex(secret),
      uninstall_hash: await sha256Hex(uninstallToken),
      name: fields.name || 'ScamFuse',
      profile: fields.profile ?? 'elder',
      language: fields.language ?? 'en',
      time_zone: fields.time_zone ?? 'UTC',
      created_at: now,
      last_seen: now,
    });
    return created ? json({ ok: true }, 201) : error('exists', 409);
  }

  if (!path.startsWith('/v1/')) return error('not-found', 404);
  const install = await authenticate(request, store);
  if (!install) return error('unauthorized', 401);

  // ---------------------------------------------------------------- the install itself
  if (path === '/v1/installs/me') {
    if (method === 'GET') {
      const guardians = await store.listGuardians(install.id);
      return json({ ok: true, guardians: guardians.map((g) => ({ name: g.name })), bot: deps.botUsername });
    }
    if (method === 'PATCH') {
      await store.updateInstall(install.id, installFields(await body(request)));
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await notifyGuardians(deps, store, install, (lang) => texts(lang).unlinked(install.name));
      await store.deleteInstall(install.id);
      return json({ ok: true });
    }
  }

  if (method === 'POST' && path === '/v1/heartbeat') {
    await store.touch(install.id, now);
    return json({ ok: true });
  }

  // ---------------------------------------------------------------- pairing
  if (method === 'POST' && path === '/v1/pairings') {
    if ((await store.listGuardians(install.id)).length >= MAX_GUARDIANS) return error('limit', 409);
    if (!(await store.allow(`pairing:${install.id}`, 30, DAY_MS, now))) return error('rate-limited', 429);
    let code = pairingCode();
    while (await store.getPairing(code)) code = pairingCode();
    const expiresAt = now + PAIRING_MS;
    await store.createPairing(code, install.id, expiresAt);
    return json({ ok: true, code, expiresAt, bot: deps.botUsername, link: `https://t.me/${deps.botUsername}?start=${code}` }, 201);
  }

  const pairingMatch = /^\/v1\/pairings\/(\d{8})$/.exec(path);
  if (method === 'GET' && pairingMatch?.[1]) {
    const pairing = await store.getPairing(pairingMatch[1]);
    if (!pairing || pairing.install_id !== install.id) return error('not-found', 404);
    if (pairing.chat_id !== null) return json({ ok: true, status: 'paired', guardianName: pairing.guardian_name ?? '' });
    return json({ ok: true, status: pairing.expires_at < now ? 'expired' : 'waiting' });
  }

  // ---------------------------------------------------------------- alerts
  if (method === 'POST' && (path === '/v1/alerts' || path === '/v1/test')) {
    const input = path === '/v1/test' ? { kind: 'test' } : await body(request);
    const kind = String(input.kind ?? '');
    if (kind !== 'test' && !ALERT_KINDS.has(kind)) return error('invalid', 400);
    const code = typeof input.code === 'string' && /^\d{6}$/.test(input.code) ? input.code : undefined;
    if ((await store.listGuardians(install.id)).length === 0) return error('no-guardians', 409);
    if (!(await store.allow(`alerts:${install.id}`, 20, DAY_MS, now))) return error('rate-limited', 429);
    const alert = {
      id: randomId(),
      install_id: install.id,
      kind,
      host: cleanHost(input.host),
      created_at: now,
      detail: cleanText(input.detail, 40) || null,
    };
    await store.createAlert(alert);
    await store.touch(install.id, now);
    const delivered = await deliverAlert(deps, store, install, alert, code);
    return json({ ok: true, id: alert.id, delivered }, 201);
  }

  const alertMatch = /^\/v1\/alerts\/([A-Za-z0-9]{6,20})$/.exec(path);
  if (method === 'GET' && alertMatch?.[1]) {
    const alert = await store.getAlert(alertMatch[1]);
    if (!alert || alert.install_id !== install.id) return error('not-found', 404);
    return json({
      ok: true,
      status: alert.status,
      always: alert.always_allow === 1,
      decidedBy: alert.decided_by,
      decidedAt: alert.decided_at,
      reply: alert.reply,
      replyBy: alert.reply_by,
    });
  }

  // ---------------------------------------------------------------- device events
  if (method === 'POST' && path === '/v1/events') {
    const type = String((await body(request)).type ?? '');
    if (!EVENT_TYPES.has(type)) return error('invalid', 400);
    if (!(await store.allow(`events:${install.id}`, 10, DAY_MS, now))) return error('rate-limited', 429);
    const delivered = await notifyGuardians(deps, store, install, (lang) =>
      texts(lang).event[type as DeviceEventType](install.name),
    );
    return json({ ok: true, delivered });
  }

  return error('not-found', 404);
}

/** Daily: tell trusted people about computers that went silent, and delete old data. */
export async function daily(deps: Deps): Promise<void> {
  const store = new Store(deps.db);
  const now = deps.now();
  for (const install of await store.silentInstalls(now - 7 * DAY_MS)) {
    await notifyGuardians(deps, store, install, (lang) => texts(lang).silent(install.name));
    await store.markSilentNotified(install.id);
  }
  await store.cleanup(now);
}
