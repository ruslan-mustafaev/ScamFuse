// Storage for the background worker. The worker may be stopped at any moment,
// so everything it needs between events lives here, not in variables.

import { normalizeSettings } from '../core/settings.ts';
import type { Allowances } from '../core/policy.ts';
import type { PinGuard } from '../core/pin.ts';
import type { LogEntry, PauseEvent, Settings } from '../core/types.ts';
import { currentLanguage } from '../shared/runtime-i18n.ts';

const DAY_MS = 24 * 60 * 60_000;

/** Runs storage updates one after another so two events cannot overwrite each other. */
let queue: Promise<unknown> = Promise.resolve();
export function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  return normalizeSettings(settings, currentLanguage(null));
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ settings });
}

export async function getLog(): Promise<LogEntry[]> {
  const { log } = await chrome.storage.local.get('log');
  return Array.isArray(log) ? (log as LogEntry[]) : [];
}

export async function saveLog(log: LogEntry[]): Promise<void> {
  await chrome.storage.local.set({ log });
}

export async function getPinGuard(): Promise<PinGuard> {
  const { pinGuard } = await chrome.storage.local.get('pinGuard');
  const guard = pinGuard as Partial<PinGuard> | undefined;
  return { fails: guard?.fails ?? 0, lockedUntil: guard?.lockedUntil ?? 0 };
}

export async function savePinGuard(pinGuard: PinGuard): Promise<void> {
  await chrome.storage.local.set({ pinGuard });
}

export async function getEvents(): Promise<Record<string, PauseEvent>> {
  const { events } = await chrome.storage.session.get('events');
  return events && typeof events === 'object' ? (events as Record<string, PauseEvent>) : {};
}

export async function saveEvents(events: Record<string, PauseEvent>): Promise<void> {
  const now = Date.now();
  const fresh: Record<string, PauseEvent> = {};
  for (const [id, event] of Object.entries(events)) {
    if (now - event.createdAt < DAY_MS) fresh[id] = event;
  }
  await chrome.storage.session.set({ events: fresh });
}

export async function getAllowances(): Promise<Allowances> {
  const { allowances } = await chrome.storage.session.get('allowances');
  return allowances && typeof allowances === 'object' ? (allowances as Allowances) : {};
}

export async function saveAllowances(allowances: Allowances): Promise<void> {
  await chrome.storage.session.set({ allowances });
}

export async function getHandledDownloads(): Promise<number[]> {
  const { handledDownloads } = await chrome.storage.session.get('handledDownloads');
  return Array.isArray(handledDownloads) ? (handledDownloads as number[]) : [];
}

export async function saveHandledDownloads(ids: number[]): Promise<void> {
  await chrome.storage.session.set({ handledDownloads: ids.slice(-500) });
}
