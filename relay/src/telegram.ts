// Minimal Telegram Bot API client: only the calls the relay needs.

import type { Keyboard, Telegram } from './types.ts';

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function telegramClient(token: string, base = 'https://api.telegram.org', fetcher: FetchLike = fetch): Telegram {
  // Why the last call failed, for /setup. Telegram's descriptions never include the token.
  let lastError = '';

  async function call<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
    lastError = '';
    try {
      const response = await fetcher(`${base}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { ok: boolean; result?: T; description?: string };
      if (!data.ok) {
        lastError = `${response.status} ${data.description ?? ''}`.trim();
        console.warn(`Telegram ${method} failed: ${lastError}`);
        return null;
      }
      return data.result ?? null;
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message.split(token).join('<token>') : 'request failed';
      console.warn(`Telegram ${method} failed: ${lastError}`);
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
      return result === true ? { ok: true } : { ok: false, error: lastError || 'unexpected answer' };
    },
    async setCommands(commands, languageCode) {
      await call('setMyCommands', { commands, ...(languageCode ? { language_code: languageCode } : {}) });
    },
    async setDescription(description, shortDescription, languageCode) {
      const language = languageCode ? { language_code: languageCode } : {};
      await call('setMyDescription', { description, ...language });
      await call('setMyShortDescription', { short_description: shortDescription, ...language });
    },
  };
}
