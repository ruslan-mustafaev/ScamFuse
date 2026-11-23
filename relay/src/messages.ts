// Texts the bot sends, in English and Russian. Plain text only: nothing from a website
// or a user is ever interpreted as formatting.

import type { AlertKind, DeviceEventType, Lang } from './types.ts';
import { defang } from './util.ts';

export function langOf(code: string | undefined | null): Lang {
  const base = (code ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  return ['ru', 'uk', 'be', 'kk', 'uz'].includes(base) ? 'ru' : 'en';
}

const TEXT = {
  en: {
    what: {
      'remote-site': 'opened the site of a remote access program',
      'remote-download': 'is installing a remote access program',
      clipboard: 'a site slipped a command into the clipboard',
      'fake-alert': 'a fake virus alert',
      'program-download': 'a program from an unofficial site',
      'screen-share': 'a site asks to share the screen',
      'card-entry': 'bank card details are being entered on a site',
      ask: 'asks you to check a page',
      test: 'test alert',
    } as Record<AlertKind, string>,
    meaning: {
      'remote-site': 'This is how scammers take control of a computer.',
      'remote-download': 'This is how scammers take control of a computer.',
      clipboard: 'This is how scammers make people run a harmful program themselves.',
      'fake-alert': 'A fake page scares people into calling scammers.',
      'program-download': 'Programs from unofficial sites often steal accounts.',
      'screen-share': 'A shared screen shows passwords and bank codes.',
      'card-entry': 'A purchase or a payment is about to happen.',
      ask: '',
      test: 'Everything works. Real alerts look like this.',
    } as Record<AlertKind, string>,
    callNow: 'Call now.',
    site: 'Site',
    time: 'Time',
    deviceTime: 'device time',
    code: 'Code to unlock by phone',
    replyHint: 'Reply to this message and your words appear on their screen.',
    allow: 'Allow',
    block: "Don't allow",
    always: 'Always allow this site',
    decidedAllow: 'Decision: allowed',
    decidedBlock: 'Decision: not allowed',
    decidedAlways: 'Decision: site allowed permanently',
    alreadyDecided: 'Already decided',
    done: 'Done',
    notYours: 'This alert is not linked to you.',
    replySent: 'Shown on their screen.',
    welcome:
      'ScamFuse sends alerts here when someone you protect is about to do something dangerous.\n\nTo link a computer, scan the QR code on its ScamFuse screen or send the 8-digit code here.',
    paired: (name: string) =>
      `Linked: ${name}. Alerts will come here. You can allow or block an action with the buttons, and a reply to an alert appears on their screen.`,
    pairExpired: 'This code has expired. Ask for a new one on the ScamFuse screen.',
    pairUnknown: 'Code not found. Check the digits on the ScamFuse screen.',
    pairFull: 'This computer already has three trusted people.',
    tooMany: 'Too many attempts. Try again in an hour.',
    status: (lines: string) => `Linked computers:\n${lines}`,
    statusNone: 'No computers are linked to this chat.',
    lastSeen: 'last seen',
    stopped: 'This chat no longer receives alerts.',
    language: 'Choose a language:',
    languageSet: 'Language: English',
    removed: (name: string) => `ScamFuse was removed from “${name}”. Protection there is off. Call to find out why.`,
    unlinked: (name: string) => `“${name}” was unlinked from ScamFuse alerts.`,
    silent: (name: string) =>
      `No signal from “${name}” for 7 days. ScamFuse may be switched off, or the computer is not used.`,
    event: {
      disabled: (name: string) => `Protection was switched off on “${name}”.`,
      'pin-locked': (name: string) => `Someone entered a wrong PIN five times on “${name}”.`,
    } as Record<DeviceEventType, (name: string) => string>,
    commands: [
      { command: 'status', description: 'Linked computers' },
      { command: 'lang', description: 'Language' },
      { command: 'stop', description: 'Stop receiving alerts' },
      { command: 'help', description: 'How it works' },
    ],
    uninstallTitle: 'ScamFuse was removed',
    uninstallText: 'Your trusted people were told. If it was a mistake, install ScamFuse again.',
  },
  ru: {
    what: {
      'remote-site': 'открыт сайт программы удалённого доступа',
      'remote-download': 'попытка установить программу удалённого доступа',
      clipboard: 'сайт подложил команду в буфер обмена',
      'fake-alert': 'поддельная вирусная тревога',
      'program-download': 'программа с неофициального сайта',
      'screen-share': 'сайт просит показать экран',
      'card-entry': 'на сайте вводят данные банковской карты',
      ask: 'просит проверить страницу',
      test: 'пробная тревога',
    } as Record<AlertKind, string>,
    meaning: {
      'remote-site': 'Так мошенники получают управление компьютером.',
      'remote-download': 'Так мошенники получают управление компьютером.',
      clipboard: 'Так мошенники заставляют человека самому запустить вредную программу.',
      'fake-alert': 'Поддельная страница пугает и просит позвонить мошенникам.',
      'program-download': 'Программы с неофициальных сайтов часто крадут аккаунты.',
      'screen-share': 'На показанном экране видны пароли и коды из банка.',
      'card-entry': 'Сейчас будет покупка или платёж.',
      ask: '',
      test: 'Всё работает. Так будут выглядеть настоящие тревоги.',
    } as Record<AlertKind, string>,
    callNow: 'Позвоните прямо сейчас.',
    site: 'Сайт',
    time: 'Время',
    deviceTime: 'по часам устройства',
    code: 'Код для разблокировки по телефону',
    replyHint: 'Ответьте на это сообщение, и текст появится на экране паузы.',
    allow: 'Разрешить',
    block: 'Не разрешать',
    always: 'Разрешить сайт навсегда',
    decidedAllow: 'Решено: разрешить',
    decidedBlock: 'Решено: не разрешать',
    decidedAlways: 'Решено: сайт разрешён навсегда',
    alreadyDecided: 'Уже решено',
    done: 'Готово',
    notYours: 'Эта тревога не связана с вами.',
    replySent: 'Показано на экране.',
    welcome:
      'ScamFuse присылает сюда тревоги, когда тот, кого вы защищаете, собирается сделать что-то опасное.\n\nЧтобы подключить компьютер, отсканируйте QR-код на экране ScamFuse или пришлите сюда 8-значный код.',
    paired: (name: string) =>
      `Подключено: ${name}. Тревоги будут приходить сюда. Кнопками можно разрешить или запретить действие, а ответ на тревогу появится на экране.`,
    pairExpired: 'Срок кода истёк. Получите новый на экране ScamFuse.',
    pairUnknown: 'Код не найден. Проверьте цифры на экране ScamFuse.',
    pairFull: 'У этого компьютера уже три доверенных человека.',
    tooMany: 'Слишком много попыток. Попробуйте через час.',
    status: (lines: string) => `Подключённые компьютеры:\n${lines}`,
    statusNone: 'К этому чату не подключено ни одного компьютера.',
    lastSeen: 'на связи',
    stopped: 'Этот чат больше не получает тревоги.',
    language: 'Выберите язык:',
    languageSet: 'Язык: русский',
    removed: (name: string) => `ScamFuse удалён с «${name}». Защита там выключена. Позвоните и узнайте, почему.`,
    unlinked: (name: string) => `«${name}» отключён от тревог ScamFuse.`,
    silent: (name: string) =>
      `«${name}» не выходит на связь 7 дней. ScamFuse мог быть выключен, или компьютером не пользуются.`,
    event: {
      disabled: (name: string) => `На «${name}» выключили защиту.`,
      'pin-locked': (name: string) => `На «${name}» пять раз ввели неверный ПИН.`,
    } as Record<DeviceEventType, (name: string) => string>,
    commands: [
      { command: 'status', description: 'Подключённые компьютеры' },
      { command: 'lang', description: 'Язык' },
      { command: 'stop', description: 'Не получать тревоги' },
      { command: 'help', description: 'Как это работает' },
    ],
    uninstallTitle: 'ScamFuse удалён',
    uninstallText: 'Доверенные люди получили сообщение. Если это ошибка, установите ScamFuse снова.',
  },
};

export type Texts = (typeof TEXT)['en'];

export function texts(lang: string): Texts {
  return TEXT[langOf(lang)] as Texts;
}

export function formatTime(at: number, lang: string, timeZone: string): string {
  const locale = langOf(lang) === 'ru' ? 'ru-RU' : 'en-GB';
  try {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone }).format(at);
  } catch {
    return `${new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(at)} UTC`;
  }
}

export interface AlertText {
  kind: AlertKind;
  installName: string;
  host: string;
  at: number;
  timeZone: string;
  code?: string;
}

const URGENT: ReadonlySet<AlertKind> = new Set(['remote-download', 'clipboard', 'fake-alert', 'screen-share']);

export function alertMessage(lang: string, alert: AlertText): string {
  const t = texts(lang);
  const lines = [`${alert.kind === 'test' ? 'ℹ️' : '⚠️'} ${alert.installName}: ${t.what[alert.kind]}`];
  if (alert.host) lines.push(`${t.site}: ${defang(alert.host)}`);
  lines.push(`${t.time}: ${formatTime(alert.at, lang, alert.timeZone)} (${t.deviceTime})`);
  if (t.meaning[alert.kind]) lines.push('', t.meaning[alert.kind]);
  if (URGENT.has(alert.kind)) lines.push(t.callNow);
  if (alert.code) lines.push('', `${t.code}: ${alert.code.slice(0, 3)} ${alert.code.slice(3)}`);
  if (alert.kind !== 'test') lines.push('', t.replyHint);
  return lines.join('\n');
}

export function decisionLine(lang: string, status: 'allowed' | 'blocked', always: boolean, by: string, at: number, timeZone: string): string {
  const t = texts(lang);
  const label = status === 'blocked' ? t.decidedBlock : always ? t.decidedAlways : t.decidedAllow;
  return `\n\n✔ ${label} — ${by}, ${formatTime(at, lang, timeZone)}`;
}

export function uninstallPage(lang: string): string {
  const t = texts(lang);
  const html = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
  return `<!doctype html><html lang="${langOf(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${html(t.uninstallTitle)}</title>
<style>body{margin:0;font:18px/1.5 system-ui,sans-serif;background:#f6f7f9;color:#101828}main{max-width:560px;margin:80px auto;padding:0 20px}h1{font-size:28px}</style></head>
<body><main><h1>${html(t.uninstallTitle)}</h1><p>${html(t.uninstallText)}</p></main></body></html>`;
}
