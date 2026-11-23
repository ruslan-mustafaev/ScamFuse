// Minimal Telegram Bot API client: only the calls the relay needs.

import type { Keyboard, Telegram } from './types.ts';

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function telegramClient(token: string, base = 'https://api.telegram.org', fetcher: FetchLike = fetch): Telegram {
  async function call<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
    try {
      const response = await fetcher(`${base}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { ok: boolean; result?: T; description?: string };
      if (!data.ok) {
        console.warn(`Telegram ${method} failed: ${data.description ?? response.status}`);
        return null;
      }
      return data.result ?? null;
    } catch (cause) {
      console.warn(`Telegram ${method} failed`, cause);
      return null;
    }
  }

  return {
    async sendMessage(chatId, text, keyboard) {
      const result = await call<{ message_id: number }>('sendMessage', {
        chat_id: chatId,
        text,
        link_preview_options: { is_disabled: true },
        ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
      });
      return result?.message_id ?? null;
    },
    async editMessage(chatId, messageId, text, keyboard?: Keyboard) {
      await call('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: keyboard ?? [] },
      });
    },
    async answerCallback(callbackId, text) {
      await call('answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text } : {}) });
    },
    async setWebhook(url, secret) {
      const result = await call<boolean>('setWebhook', {
        url,
        secret_token: secret,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true,
      });
      return result === true;
    },
    async setCommands(commands, languageCode) {
      await call('setMyCommands', { commands, ...(languageCode ? { language_code: languageCode } : {}) });
    },
  };
}
