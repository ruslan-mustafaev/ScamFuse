// Records what the bot would send, instead of calling Telegram. Used by tests and the local relay.

import type { Keyboard, Telegram } from '../src/types.ts';

export interface SentMessage {
  chatId: number;
  messageId: number;
  text: string;
  keyboard?: Keyboard;
  edits: string[];
}

export interface FakeTelegram extends Telegram {
  sent: SentMessage[];
  answers: { id: string; text?: string }[];
  lastTo(chatId: number): SentMessage | undefined;
}

export function fakeTelegram(): FakeTelegram {
  let nextId = 100;
  const sent: SentMessage[] = [];
  const answers: { id: string; text?: string }[] = [];
  return {
    sent,
    answers,
    lastTo(chatId) {
      return [...sent].reverse().find((message) => message.chatId === chatId);
    },
    async sendMessage(chatId, text, keyboard) {
      nextId += 1;
      sent.push({ chatId, messageId: nextId, text, keyboard, edits: [] });
      return nextId;
    },
    async editMessage(chatId, messageId, text) {
      sent.find((message) => message.chatId === chatId && message.messageId === messageId)?.edits.push(text);
    },
    async answerCallback(id, text) {
      answers.push({ id, text });
    },
    async setWebhook() {
      return true;
    },
    async setCommands() {},
    async setDescription() {},
  };
}
