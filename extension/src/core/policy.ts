// Rules for when a stopped action may continue, which sites are allowed, and the local log.
// Pure functions; the background worker stores the data.

import { hostMatches } from './domains.ts';
import { ADVICE_DELAY_SECONDS, ALLOW_MINUTES, LOG_LIMIT } from './settings.ts';
import type { EventKind, LogEntry, Mode, PauseEvent } from './types.ts';

/** Time from which "Continue anyway" works without the PIN. */
export function continueAvailableAt(event: Pick<PauseEvent, 'createdAt'>, mode: Mode, lockMinutes: number): number {
  return mode === 'strict'
    ? event.createdAt + lockMinutes * 60_000
    : event.createdAt + ADVICE_DELAY_SECONDS * 1000;
}

/** host → time until which it is allowed */
export type Allowances = Record<string, number>;

export function isAllowed(host: string, allowances: Allowances, trustedSites: readonly string[], now: number): boolean {
  if (!host) return false;
  if (hostMatches(host, trustedSites)) return true;
  const until = allowances[host];
  return typeof until === 'number' && until > now;
}

export function allow(allowances: Allowances, host: string, now: number): Allowances {
  const next: Allowances = {};
  for (const [key, until] of Object.entries(allowances)) if (until > now) next[key] = until;
  if (host) next[host] = now + ALLOW_MINUTES * 60_000;
  return next;
}

/** Same kind of event from the same site within 10 minutes reuses the open pause. */
export const REPEAT_WINDOW_MS = 10 * 60_000;

export function findRepeat(
  events: readonly PauseEvent[],
  kind: EventKind,
  host: string,
  now: number,
): PauseEvent | undefined {
  return events.find(
    (event) =>
      event.kind === kind &&
      event.host === host &&
      event.outcome !== 'allowed' &&
      now - event.createdAt < REPEAT_WINDOW_MS &&
      event.downloadId === undefined,
  );
}

export function appendLog(log: readonly LogEntry[], entry: LogEntry): LogEntry[] {
  return [entry, ...log.filter((item) => item.id !== entry.id)].slice(0, LOG_LIMIT);
}

export function updateLog(log: readonly LogEntry[], id: string, patch: Partial<LogEntry>): LogEntry[] {
  return log.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

export function startOfDay(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function countToday(log: readonly LogEntry[], now: number): number {
  const start = startOfDay(now);
  return log.filter((item) => item.at >= start).length;
}

export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
