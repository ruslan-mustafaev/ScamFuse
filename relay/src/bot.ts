// Telegram updates: linking a chat, buttons under alerts, replies, commands.

import { alertMessage, decisionLine, formatTime, langOf, texts } from './messages.ts';
import { MAX_GUARDIANS, Store } from './store.ts';
import type { AlertKind, AlertRow, Deps, InstallRow } from './types.ts';
import { cleanText } from './util.ts';

interface TgUser {
  id: number;
  first_name?: string;
  language_code?: string;
}
interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
  reply_to_message?: { message_id: number };
}
interface TgCallback {
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
}
export interface TgUpdate {
  message?: TgMessage;
  callback_query?: TgCallback;
}

const HOUR_MS = 60 * 60_000;

async function chatLang(store: Store, chatId: number, user?: TgUser): Promise<string> {
  return (await store.chatLanguage(chatId)) ?? langOf(user?.language_code);
}

function displayName(user?: TgUser): string {
  return cleanText(user?.first_name, 40) || 'Telegram';
}

export async function handleUpdate(update: TgUpdate, deps: Deps): Promise<void> {
  const store = new Store(deps.db);
  if (update.callback_query) return handleCallback(update.callback_query, deps, store);
  const message = update.message;
  if (!message?.text || message.chat.type !== 'private') return;
  const chatId = message.chat.id;
  const text = message.text.trim();
  const lang = await chatLang(store, chatId, message.from);
  const t = texts(lang);

  if (message.reply_to_message && !text.startsWith('/')) {
    const alert = await store.alertForMessage(chatId, message.reply_to_message.message_id);
    if (alert) {
      await store.setReply(alert.id, cleanText(text, 200), displayName(message.from));
      await deps.telegram.sendMessage(chatId, t.replySent);
      return;
    }
  }

  const start = /^\/start(?:\s+(\S+))?$/.exec(text);
  const digits = text.replace(/[\s-]/g, '');
  if (start?.[1] || /^\d{8}$/.test(digits)) {
    await pair(start?.[1] ?? digits, message, deps, store);
    return;
  }
  if (start || text === '/help') {
    await deps.telegram.sendMessage(chatId, t.welcome);
    return;
  }
  if (text === '/status') {
    const installs = await store.installsForChat(chatId);
    const lines = installs.map(
      (install) => `• ${install.name} — ${t.lastSeen} ${formatTime(install.last_seen, lang, install.time_zone)}`,
    );
    await deps.telegram.sendMessage(chatId, lines.length ? t.status(lines.join('\n')) : t.statusNone);
    return;
  }
  if (text === '/stop') {
    await store.removeChat(chatId);
    await deps.telegram.sendMessage(chatId, t.stopped);
    return;
  }
  if (text === '/lang') {
    await deps.telegram.sendMessage(chatId, t.language, [
      [
        { text: 'English', callback_data: 'l:en' },
        { text: 'Русский', callback_data: 'l:ru' },
      ],
    ]);
    return;
  }
  await deps.telegram.sendMessage(chatId, t.welcome);
}

async function pair(code: string, message: TgMessage, deps: Deps, store: Store): Promise<void> {
  const chatId = message.chat.id;
  const lang = langOf(message.from?.language_code);
  const t = texts((await store.chatLanguage(chatId)) ?? lang);
  const now = deps.now();
  if (!(await store.allow(`pair:${chatId}`, 10, HOUR_MS, now))) {
    await deps.telegram.sendMessage(chatId, t.tooMany);
    return;
  }
  const pairing = /^\d{8}$/.test(code) ? await store.getPairing(code) : null;
  if (!pairing) {
    await deps.telegram.sendMessage(chatId, t.pairUnknown);
    return;
  }
  if (pairing.expires_at < now || (pairing.chat_id !== null && pairing.chat_id !== chatId)) {
    await deps.telegram.sendMessage(chatId, t.pairExpired);
    return;
  }
  const install = await store.getInstall(pairing.install_id);
  if (!install || install.removed_at) {
    await deps.telegram.sendMessage(chatId, t.pairExpired);
    return;
  }
  const guardians = await store.listGuardians(install.id);
  if (guardians.length >= MAX_GUARDIANS && !guardians.some((g) => g.chat_id === chatId)) {
    await deps.telegram.sendMessage(chatId, t.pairFull);
    return;
  }
  const name = displayName(message.from);
  await store.addGuardian({
    install_id: install.id,
    chat_id: chatId,
    name,
    language: (await store.chatLanguage(chatId)) ?? lang,
    created_at: now,
  });
  await store.usePairing(code, chatId, name);
  await deps.telegram.sendMessage(chatId, t.paired(install.name));
}

function decisionKeyboard(lang: string, alertId: string) {
  const t = texts(lang);
  return [
    [
      { text: `✅ ${t.allow}`, callback_data: `d:${alertId}:a` },
      { text: `⛔ ${t.block}`, callback_data: `d:${alertId}:b` },
    ],
    [{ text: t.always, callback_data: `d:${alertId}:t` }],
  ];
}

/** Sends an alert to every trusted person of the install. Returns how many received it. */
export async function deliverAlert(
  deps: Deps,
  store: Store,
  install: InstallRow,
  alert: Pick<AlertRow, 'id' | 'kind' | 'host' | 'created_at' | 'detail'>,
  code?: string,
): Promise<number> {
  const guardians = await store.listGuardians(install.id);
  let delivered = 0;
  for (const guardian of guardians) {
    const text = alertMessage(guardian.language, {
      kind: alert.kind as AlertKind,
      installName: install.name,
      host: alert.host,
      at: alert.created_at,
      timeZone: install.time_zone,
      code,
      detail: alert.detail,
    });
    const keyboard = alert.kind === 'test' || alert.kind === 'ask' ? undefined : decisionKeyboard(guardian.language, alert.id);
    const messageId = await deps.telegram.sendMessage(guardian.chat_id, text, keyboard);
    if (messageId !== null) {
      delivered += 1;
      await store.addAlertMessage(alert.id, guardian.chat_id, messageId);
    }
  }
  return delivered;
}

/** Plain notice (removed, silent, switched off) to every trusted person. */
export async function notifyGuardians(
  deps: Deps,
  store: Store,
  install: InstallRow,
  build: (lang: string) => string,
): Promise<number> {
  const guardians = await store.listGuardians(install.id);
  let delivered = 0;
  for (const guardian of guardians) {
    if ((await deps.telegram.sendMessage(guardian.chat_id, build(guardian.language))) !== null) delivered += 1;
  }
  return delivered;
}

async function handleCallback(callback: TgCallback, deps: Deps, store: Store): Promise<void> {
  const chatId = callback.message?.chat.id ?? callback.from.id;
  const lang = await chatLang(store, chatId, callback.from);
  const data = callback.data ?? '';

  const language = /^l:(en|ru)$/.exec(data);
  if (language?.[1]) {
    await store.setChatLanguage(chatId, language[1]);
    await deps.telegram.answerCallback(callback.id, texts(language[1]).languageSet);
    return;
  }

  const decision = /^d:([A-Za-z0-9]{6,20}):([abt])$/.exec(data);
  if (!decision?.[1] || !decision[2]) {
    await deps.telegram.answerCallback(callback.id);
    return;
  }
  const t = texts(lang);
  const alert = await store.getAlert(decision[1]);
  const install = alert ? await store.getInstall(alert.install_id) : null;
  if (!alert || !install || !(await store.isGuardian(install.id, chatId))) {
    await deps.telegram.answerCallback(callback.id, t.notYours);
    return;
  }
  const status = decision[2] === 'b' ? 'blocked' : 'allowed';
  const always = decision[2] === 't';
  const by = displayName(callback.from);
  const now = deps.now();
  const first = await store.decideAlert(alert.id, status, always, by, now);
  if (!first) {
    await deps.telegram.answerCallback(callback.id, t.alreadyDecided);
    return;
  }
  await deps.telegram.answerCallback(callback.id, t.done);

  // Every trusted person sees who decided, and the buttons disappear.
  const guardians = await store.listGuardians(install.id);
  for (const message of await store.alertMessages(alert.id)) {
    const guardianLang = guardians.find((g) => g.chat_id === message.chat_id)?.language ?? lang;
    const original = alertMessage(guardianLang, {
      kind: alert.kind as AlertKind,
      installName: install.name,
      host: alert.host,
      at: alert.created_at,
      timeZone: install.time_zone,
      detail: alert.detail,
    });
    await deps.telegram.editMessage(
      message.chat_id,
      message.message_id,
      original + decisionLine(guardianLang, status, always, by, now, install.time_zone),
    );
  }
}
