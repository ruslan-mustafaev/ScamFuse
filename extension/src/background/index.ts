// Background worker: receives signals, pauses dangerous actions and carries out decisions.

import siteRules from '../rules/sites.json' with { type: 'json' };
import { classifyDownload, isRemoteToolSite } from '../core/downloads.ts';
// isRemoteToolSite: pages of remote access programs are paused when they open (see pageStatus).
import { hostMatches, hostOf } from '../core/domains.ts';
import { nextGuard, hashPin, verifyPin } from '../core/pin.ts';
import {
  allow,
  appendLog,
  continueAvailableAt,
  countToday,
  findRepeat,
  isAllowed,
  newId,
  updateLog,
} from '../core/policy.ts';
import { PIN_MAX_ATTEMPTS } from '../core/pin.ts';
import { defaultDetectors, isValidPin, normalizeSettings } from '../core/settings.ts';
import type {
  ContentMessage,
  DecidedBy,
  DecideResult,
  EventKind,
  Level,
  PageMessage,
  PageStatus,
  PauseEvent,
  PauseView,
  PublicState,
  Settings,
  SetupInput,
} from '../core/types.ts';
import { getTranslator } from '../shared/runtime-i18n.ts';
import {
  getAllowances,
  getEvents,
  getHandledDownloads,
  getLog,
  getPinGuard,
  getSettings,
  saveAllowances,
  saveEvents,
  saveHandledDownloads,
  saveLog,
  savePinGuard,
  saveSettings,
  serial,
} from './store.ts';

const PAUSE_PAGE = 'pages/pause.html';
const WELCOME_PAGE = 'pages/welcome.html';
const REASON_PATTERN = /^[a-z0-9:-]{1,40}$/;

// ---------------------------------------------------------------- lifecycle

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    if (details.reason === 'install') {
      await chrome.tabs.create({ url: chrome.runtime.getURL(WELCOME_PAGE) });
    }
    await refreshAction();
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void refreshAction();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ('settings' in changes || 'log' in changes)) void refreshAction();
});

async function refreshAction(): Promise<void> {
  const [settings, log] = await Promise.all([getSettings(), getLog()]);
  const tr = await getTranslator(settings.language);
  const count = countToday(log, Date.now());
  const state = settings.enabled ? 'on' : 'off';
  await chrome.action.setIcon({
    path: {
      16: `icons/${state}-16.png`,
      32: `icons/${state}-32.png`,
      48: `icons/${state}-48.png`,
      128: `icons/${state}-128.png`,
    },
  });
  await chrome.action.setBadgeText({ text: count > 0 ? String(Math.min(count, 99)) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#B42318' });
  await chrome.action.setTitle({
    title: `${tr.t('extName')}: ${tr.t(settings.enabled ? 'popup_on' : 'popup_off')}`,
  });
}

// ---------------------------------------------------------------- pausing

interface PauseRequest {
  kind: EventKind;
  level: Level;
  host: string;
  url: string;
  reasons: string[];
  tabId?: number;
  downloadId?: number;
  ownTab?: boolean;
  mute?: boolean;
}

async function openPause(request: PauseRequest): Promise<void> {
  const now = Date.now();
  const events = await getEvents();
  const repeat = findRepeat(Object.values(events), request.kind, request.host, now);
  let event: PauseEvent;
  if (repeat) {
    // A repeat starts the waiting time again: pressing on is never faster than the first time.
    event = {
      ...repeat,
      outcome: 'pending',
      createdAt: now,
      tabId: request.tabId ?? repeat.tabId,
      url: request.url || repeat.url,
    };
  } else {
    event = {
      id: newId(),
      kind: request.kind,
      level: request.level,
      host: request.host,
      url: request.url,
      createdAt: now,
      tabId: request.tabId,
      downloadId: request.downloadId,
      ownTab: request.ownTab,
      outcome: 'pending',
      reasons: request.reasons,
    };
    const log = await getLog();
    await saveLog(
      appendLog(log, { id: event.id, at: now, kind: event.kind, host: event.host, outcome: 'pending' }),
    );
  }
  events[event.id] = event;
  await saveEvents(events);

  const pauseUrl = chrome.runtime.getURL(`${PAUSE_PAGE}?id=${event.id}`);
  if (request.ownTab || request.tabId === undefined) {
    const tab = await chrome.tabs.create({ url: pauseUrl, active: true });
    events[event.id] = { ...event, tabId: tab.id, ownTab: true };
    await saveEvents(events);
  } else {
    if (request.mute) await chrome.tabs.update(request.tabId, { muted: true }).catch(() => undefined);
    await chrome.tabs.update(request.tabId, { url: pauseUrl });
  }
}

function cleanReasons(reasons: unknown): string[] {
  if (!Array.isArray(reasons)) return [];
  return reasons
    .filter((reason): reason is string => typeof reason === 'string' && REASON_PATTERN.test(reason))
    .slice(0, 16);
}

async function siteAllowed(settings: Settings, host: string, kind: EventKind): Promise<boolean> {
  const allowances = await getAllowances();
  return isAllowed(host, kind, allowances, settings.trustedSites, Date.now());
}

// ---------------------------------------------------------------- downloads

function downloadHost(item: chrome.downloads.DownloadItem): string {
  const source = item.finalUrl || item.url;
  const direct = source.startsWith('blob:') ? hostOf(source.slice(5)) : hostOf(source);
  return direct || hostOf(item.referrer);
}

/** File name in the link itself ("…/AnyDesk.exe"): known at once, before the browser picks a name. */
function linkFileName(url: string): string {
  if (!/^https?:/i.test(url)) return '';
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  } catch {
    return '';
  }
}

async function checkDownload(item: chrome.downloads.DownloadItem): Promise<void> {
  if (item.state === 'interrupted') return;
  const handled = await getHandledDownloads();
  if (handled.includes(item.id)) return;
  const settings = await getSettings();
  if (!settings.enabled) return;
  const host = downloadHost(item);

  // Both the saved name and the name in the link count: either may give the program away.
  const names = [...new Set([item.filename, linkFileName(item.finalUrl || item.url), ''])];
  let verdict = null;
  for (const fileName of names) {
    verdict = classifyDownload({
      host,
      fileName,
      remoteAccess: settings.detectors.remoteAccess,
      programDownload: settings.detectors.programDownload,
    });
    if (verdict) break;
  }
  // No verdict yet: the browser may still report the final name in onChanged.
  if (!verdict) return;
  if (await siteAllowed(settings, host, verdict.kind)) return;

  await saveHandledDownloads([...handled, item.id]);
  if (item.state === 'in_progress') await chrome.downloads.pause(item.id).catch(() => undefined);
  await openPause({
    kind: verdict.kind,
    level: verdict.level,
    host,
    url: '',
    reasons: verdict.reasons,
    downloadId: item.id,
    ownTab: true,
  });
}

chrome.downloads.onCreated.addListener((item) => {
  void serial(() => checkDownload(item));
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.filename?.current) return;
  void serial(async () => {
    const [item] = await chrome.downloads.search({ id: delta.id });
    if (item) await checkDownload(item);
  });
});

async function finishDownload(downloadId: number, allowed: boolean): Promise<void> {
  const [item] = await chrome.downloads.search({ id: downloadId });
  if (!item) return;
  if (allowed) {
    if (item.state === 'in_progress' && item.paused) await chrome.downloads.resume(downloadId).catch(() => undefined);
    return;
  }
  if (item.state === 'in_progress') {
    await chrome.downloads.cancel(downloadId).catch(() => undefined);
  } else if (item.state === 'complete' && item.exists) {
    await chrome.downloads.removeFile(downloadId).catch(() => undefined);
  }
  await chrome.downloads.erase({ id: downloadId }).catch(() => undefined);
}

// ---------------------------------------------------------------- PIN

interface PinCheck {
  ok: boolean;
  attemptsLeft: number;
  lockedUntil: number;
}

async function checkPin(settings: Settings, pin: string | undefined): Promise<PinCheck> {
  const now = Date.now();
  const guard = await getPinGuard();
  if (guard.lockedUntil > now) return { ok: false, attemptsLeft: 0, lockedUntil: guard.lockedUntil };
  if (!settings.pin || typeof pin !== 'string') return { ok: false, attemptsLeft: PIN_MAX_ATTEMPTS - guard.fails, lockedUntil: 0 };
  const ok = await verifyPin(pin, settings.pin);
  const next = nextGuard(guard, ok, now);
  await savePinGuard(next);
  return { ok, attemptsLeft: PIN_MAX_ATTEMPTS - next.fails, lockedUntil: next.lockedUntil };
}

/** Changes are free while no PIN is set; with a PIN they need it. */
async function authorized(settings: Settings, pin: string | undefined): Promise<boolean> {
  if (!settings.pin) return true;
  return (await checkPin(settings, pin)).ok;
}

// ---------------------------------------------------------------- decisions

async function decide(
  message: Extract<PageMessage, { type: 'decide' }>,
  sender: chrome.runtime.MessageSender,
): Promise<DecideResult> {
  const events = await getEvents();
  const event = events[message.id];
  if (!event) return { ok: false, error: 'missing' };
  if (event.outcome !== 'pending') return { ok: false, error: 'decided' };
  const settings = await getSettings();
  const now = Date.now();
  const tabId = sender.tab?.id ?? event.tabId;

  if (message.decision === 'allow') {
    let decidedBy: DecidedBy;
    if (message.pin) {
      const check = await checkPin(settings, message.pin);
      if (!check.ok) {
        return check.lockedUntil
          ? { ok: false, error: 'pin-locked', lockedUntil: check.lockedUntil }
          : { ok: false, error: 'wrong-pin', attemptsLeft: check.attemptsLeft };
      }
      decidedBy = 'pin';
    } else {
      if (now < continueAvailableAt(event, settings.mode, settings.lockMinutes)) {
        return { ok: false, error: 'locked' };
      }
      decidedBy = settings.mode === 'strict' ? 'timer' : 'user';
    }
    events[event.id] = { ...event, outcome: 'allowed', decidedBy, decidedAt: now };
    await saveEvents(events);
    await saveAllowances(allow(await getAllowances(), event.kind, event.host, now));
    await saveLog(updateLog(await getLog(), event.id, { outcome: 'allowed', decidedBy }));

    if (event.downloadId !== undefined) {
      await finishDownload(event.downloadId, true);
      if (event.ownTab && tabId !== undefined) await chrome.tabs.remove(tabId).catch(() => undefined);
    } else if (tabId !== undefined && event.url) {
      if (event.kind === 'fake-alert') await chrome.tabs.update(tabId, { muted: false }).catch(() => undefined);
      await chrome.tabs.update(tabId, { url: event.url });
    }
    return { ok: true };
  }

  events[event.id] = { ...event, outcome: 'blocked', decidedBy: 'user', decidedAt: now };
  await saveEvents(events);
  await saveLog(updateLog(await getLog(), event.id, { outcome: 'blocked', decidedBy: 'user' }));
  if (event.downloadId !== undefined) {
    await finishDownload(event.downloadId, false);
    if (event.ownTab && tabId !== undefined) await chrome.tabs.remove(tabId).catch(() => undefined);
  } else if (tabId !== undefined) {
    if (event.kind === 'fake-alert') await chrome.tabs.update(tabId, { muted: false }).catch(() => undefined);
    await chrome.tabs.update(tabId, { url: 'chrome://newtab/' }).catch(() =>
      chrome.tabs.update(tabId, { url: 'about:blank' }),
    );
  }
  return { ok: true };
}

// ---------------------------------------------------------------- messages from pages

async function publicState(): Promise<PublicState> {
  const [settings, log] = await Promise.all([getSettings(), getLog()]);
  const { pin, ...rest } = settings;
  return {
    settings: { ...rest, hasPin: pin !== null },
    todayCount: countToday(log, Date.now()),
    log: log.slice(0, 50),
    version: chrome.runtime.getManifest().version,
  };
}

async function pauseView(id: string): Promise<PauseView | null> {
  const events = await getEvents();
  const event = events[id];
  if (!event) return null;
  const [settings, guard] = await Promise.all([getSettings(), getPinGuard()]);
  return {
    event,
    profile: settings.profile,
    mode: settings.mode,
    lockMinutes: settings.lockMinutes,
    hasPin: settings.pin !== null,
    guardianName: settings.guardianName,
    guardianPhone: settings.guardianPhone,
    guardianEmail: settings.guardianEmail,
    channel: settings.channel,
    language: settings.language,
    pinLockedUntil: guard.lockedUntil > Date.now() ? guard.lockedUntil : 0,
    pinAttemptsLeft: PIN_MAX_ATTEMPTS - guard.fails,
  };
}

async function completeSetup(setup: SetupInput): Promise<DecideResult> {
  const settings = await getSettings();
  if (!(await authorized(settings, setup.pin))) return { ok: false, error: 'wrong-pin' };
  let pin = settings.pin;
  if (setup.newPin) {
    if (!isValidPin(setup.newPin)) return { ok: false, error: 'invalid' };
    pin = await hashPin(setup.newPin);
  }
  const next = normalizeSettings({
    ...settings,
    setupDone: true,
    enabled: true,
    profile: setup.profile,
    mode: pin && setup.profile !== 'self' ? 'strict' : 'advice',
    guardianName: setup.guardianName,
    guardianPhone: setup.guardianPhone,
    guardianEmail: setup.guardianEmail,
    channel: setup.channel,
    language: setup.language,
    detectors: defaultDetectors(setup.profile),
    pin,
  });
  await saveSettings(next);
  return { ok: true };
}

async function handlePageMessage(message: PageMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case 'getEvent':
      return pauseView(String(message.id));
    case 'decide':
      return serial(() => decide(message, sender));
    case 'markAsked':
      return serial(async () => {
        const events = await getEvents();
        const event = events[String(message.id)];
        if (event) {
          events[event.id] = { ...event, asked: true };
          await saveEvents(events);
        }
        return { ok: true };
      });
    case 'verifyPin': {
      const settings = await getSettings();
      return serial(() => checkPin(settings, message.pin));
    }
    case 'getState':
      return publicState();
    case 'completeSetup':
      return serial(() => completeSetup(message.setup));
    case 'saveSettings':
      return serial(async () => {
        const settings = await getSettings();
        const keys = Object.keys(message.patch ?? {});
        // The language is not a protection setting: anyone may switch it.
        const languageOnly = keys.length === 1 && keys[0] === 'language';
        if (!languageOnly && !(await authorized(settings, message.pin))) return { ok: false, error: 'wrong-pin' };
        const { pin: _ignored, version: _version, ...patch } = message.patch as Record<string, unknown>;
        await saveSettings(normalizeSettings({ ...settings, ...patch, pin: settings.pin }));
        return { ok: true };
      });
    case 'setPin':
      return serial(async () => {
        const settings = await getSettings();
        if (!(await authorized(settings, message.pin))) return { ok: false, error: 'wrong-pin' };
        if (message.newPin !== null && !isValidPin(message.newPin)) return { ok: false, error: 'invalid' };
        const pin = message.newPin === null ? null : await hashPin(message.newPin);
        await saveSettings(normalizeSettings({ ...settings, pin }));
        return { ok: true };
      });
    case 'clearLog':
      return serial(async () => {
        const settings = await getSettings();
        if (!(await authorized(settings, message.pin))) return { ok: false, error: 'wrong-pin' };
        await saveLog([]);
        return { ok: true };
      });
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------- messages from content scripts

async function pageStatus(sender: chrome.runtime.MessageSender): Promise<PageStatus> {
  const settings = await getSettings();
  const tr = await getTranslator(settings.language);
  const host = hostOf(sender.tab?.url ?? sender.url);

  if (
    settings.enabled &&
    settings.detectors.remoteAccess &&
    sender.frameId === 0 &&
    sender.tab?.id !== undefined &&
    isRemoteToolSite(host) &&
    !(await siteAllowed(settings, host, 'remote-site'))
  ) {
    await serial(() =>
      openPause({
        kind: 'remote-site',
        level: 'medium',
        host,
        url: sender.tab?.url ?? sender.url ?? '',
        reasons: ['remote-site'],
        tabId: sender.tab?.id,
      }),
    );
  }

  return {
    clipboard:
      settings.enabled &&
      settings.detectors.clipboard &&
      !hostMatches(host, siteRules.developerSites) &&
      !(await siteAllowed(settings, host, 'clipboard')),
    fakeAlert:
      settings.enabled &&
      settings.detectors.fakeAlert &&
      !(await siteAllowed(settings, host, 'fake-alert')),
    safeText: tr.t('clip_safe'),
  };
}

async function signal(
  message: Extract<ContentMessage, { type: 'signal' }>,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return;
  const settings = await getSettings();
  if (!settings.enabled) return;
  const kind = message.kind === 'clipboard' ? 'clipboard' : 'fake-alert';
  if (!settings.detectors[kind === 'clipboard' ? 'clipboard' : 'fakeAlert']) return;
  const url = sender.tab?.url ?? sender.url ?? '';
  const host = hostOf(url);
  if (await siteAllowed(settings, host, kind)) return;
  if (kind === 'clipboard' && hostMatches(host, siteRules.developerSites)) return;
  await serial(() =>
    openPause({
      kind,
      level: 'high',
      host,
      url,
      reasons: cleanReasons(message.reasons),
      tabId,
      mute: kind === 'fake-alert',
    }),
  );
}

// ---------------------------------------------------------------- router

function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return false;
  const typed = message as { type?: unknown };
  let work: Promise<unknown>;
  if (fromExtensionPage(sender)) {
    work = handlePageMessage(message as PageMessage, sender);
  } else if (typed.type === 'pageStatus') {
    work = pageStatus(sender);
  } else if (typed.type === 'signal') {
    work = signal(message as Extract<ContentMessage, { type: 'signal' }>, sender);
  } else {
    return false;
  }
  work.then(sendResponse, (error: unknown) => {
    console.error('ScamFuse:', error);
    sendResponse(undefined);
  });
  return true;
});
