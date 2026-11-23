// Cloudflare Worker entry point.

import { daily, handle } from './app.ts';
import { telegramClient } from './telegram.ts';
import type { Deps, Env } from './types.ts';

function deps(env: Env): Deps {
  return {
    db: env.DB,
    telegram: telegramClient(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_API || 'https://api.telegram.org'),
    botUsername: env.BOT_USERNAME,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    now: () => Date.now(),
  };
}

interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, deps(env));
  },
  scheduled(_event: unknown, env: Env, ctx: WaitUntil): void {
    ctx.waitUntil(daily(deps(env)));
  },
};
