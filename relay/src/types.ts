// Types for the alert relay (Cloudflare Worker).

/** The part of Cloudflare D1 the relay uses. Tests run the same SQL on node:sqlite. */
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface D1Database {
  prepare(sql: string): D1Statement;
}

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  BOT_USERNAME: string;
  TELEGRAM_API?: string;
}

export type Lang = 'en' | 'ru';

export type AlertKind =
  | 'remote-site'
  | 'remote-download'
  | 'clipboard'
  | 'fake-alert'
  | 'program-download'
  | 'screen-share'
  | 'card-entry'
  | 'phishing'
  | 'ask'
  | 'test';

export type DeviceEventType = 'disabled' | 'pin-locked';

export interface InstallRow {
  id: string;
  secret_hash: string;
  uninstall_hash: string;
  name: string;
  profile: string;
  language: string;
  time_zone: string;
  created_at: number;
  last_seen: number;
  silent_notified: number;
  removed_at: number | null;
}

export interface GuardianRow {
  install_id: string;
  chat_id: number;
  name: string;
  language: string;
  created_at: number;
}

export interface PairingRow {
  code: string;
  install_id: string;
  expires_at: number;
  chat_id: number | null;
  guardian_name: string | null;
}

export interface AlertRow {
  id: string;
  install_id: string;
  kind: string;
  host: string;
  created_at: number;
  status: 'pending' | 'allowed' | 'blocked';
  always_allow: number;
  decided_by: string | null;
  decided_at: number | null;
  reply: string | null;
  reply_by: string | null;
  detail: string | null;
}

export interface TelegramButton {
  text: string;
  callback_data: string;
}
export type Keyboard = TelegramButton[][];

export interface Telegram {
  sendMessage(chatId: number, text: string, keyboard?: Keyboard): Promise<number | null>;
  editMessage(chatId: number, messageId: number, text: string, keyboard?: Keyboard): Promise<void>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
  setWebhook(url: string, secret: string): Promise<boolean>;
  setCommands(commands: { command: string; description: string }[], languageCode?: string): Promise<void>;
}

export interface Deps {
  db: D1Database;
  telegram: Telegram;
  botUsername: string;
  webhookSecret: string;
  now: () => number;
}
