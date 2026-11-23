// Talks to the alert relay. Every call is optional: without a relay or a connection,
// protection on the computer works the same and only the automatic alerts are missing.

import { currentLanguage } from '../shared/runtime-i18n.ts';
import type { EventKind, PairingInfo, PairingStatus, Settings } from '../core/types.ts';

const TIMEOUT_MS = 8000;

export interface RelayCredentials {
  url: string;
  installId: string;
  secret: string;
  uninstallToken: string;
  guardians: string[];
  bot: string;
}

export interface AlertStatus {
  status: 'pending' | 'allowed' | 'blocked';
  always: boolean;
  decidedBy: string | null;
  reply: string | null;
  replyBy: string | null;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getCredentials(): Promise<RelayCredentials | null> {
  const { relay } = await chrome.storage.local.get('relay');
  const value = relay as RelayCredentials | undefined;
  return value && typeof value.installId === 'string' ? value : null;
}

async function saveCredentials(credentials: RelayCredentials | null): Promise<void> {
  if (credentials) await chrome.storage.local.set({ relay: credentials });
  else await chrome.storage.local.remove('relay');
}

async function request<T>(
  credentials: Pick<RelayCredentials, 'url' | 'installId' | 'secret'> | null,
  url: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; data: T | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${url}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        ...(credentials ? { authorization: `Bearer ${credentials.installId}:${credentials.secret}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
    let data: T | null = null;
    try {
      data = (await response.json()) as T;
    } catch {
      data = null;
    }
    return { status: response.status, data };
  } catch {
    return { status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

function installFields(settings: Settings) {
  return {
    name: settings.installName || 'ScamFuse',
    profile: settings.profile,
    language: currentLanguage(settings.language),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  };
}

/** Registers this browser with the relay the first time it is needed. */
export async function ensureRegistered(settings: Settings): Promise<RelayCredentials | null> {
  if (!settings.relayUrl) return null;
  const existing = await getCredentials();
  if (existing && existing.url === settings.relayUrl) return existing;

  const credentials: RelayCredentials = {
    url: settings.relayUrl,
    installId: hex(crypto.getRandomValues(new Uint8Array(16))),
    secret: base64url(crypto.getRandomValues(new Uint8Array(32))),
    uninstallToken: base64url(crypto.getRandomValues(new Uint8Array(32))),
    guardians: [],
    bot: '',
  };
  const { status } = await request(null, settings.relayUrl, '/v1/installs', {
    method: 'POST',
    body: {
      installId: credentials.installId,
      secret: credentials.secret,
      uninstallToken: credentials.uninstallToken,
      ...installFields(settings),
    },
  });
  if (status !== 201) return null;
  await saveCredentials(credentials);
  await applyUninstallUrl(credentials);
  return credentials;
}

/** When the extension is removed, the browser opens this address and the relay tells the trusted people. */
export async function applyUninstallUrl(credentials: RelayCredentials | null): Promise<void> {
  const url = credentials
    ? `${credentials.url}/u?i=${credentials.installId}&t=${credentials.uninstallToken}`
    : '';
  await chrome.runtime.setUninstallURL(url).catch(() => undefined);
}

export async function startPairing(settings: Settings): Promise<PairingInfo> {
  const credentials = await ensureRegistered(settings);
  if (!credentials) return { ok: false, error: 'relay' };
  const { status, data } = await request<PairingInfo>(credentials, credentials.url, '/v1/pairings', { method: 'POST' });
  if (status !== 201 || !data) return { ok: false, error: status === 409 ? 'limit' : 'relay' };
  return data;
}

export async function pairingStatus(code: string): Promise<PairingStatus> {
  const credentials = await getCredentials();
  if (!credentials || !/^\d{8}$/.test(code)) return { ok: false };
  const { data } = await request<PairingStatus>(credentials, credentials.url, `/v1/pairings/${code}`);
  if (data?.status === 'paired') await refreshGuardians();
  return data ?? { ok: false };
}

/** Updates the cached list of linked people. */
export async function refreshGuardians(): Promise<string[]> {
  const credentials = await getCredentials();
  if (!credentials) return [];
  const { status, data } = await request<{ guardians: { name: string }[]; bot: string }>(
    credentials,
    credentials.url,
    '/v1/installs/me',
  );
  if (status === 401) {
    // The relay forgot this install (unlinked or removed): start clean next time.
    await saveCredentials(null);
    return [];
  }
  if (!data) return credentials.guardians;
  const guardians = data.guardians.map((g) => g.name);
  await saveCredentials({ ...credentials, guardians, bot: data.bot ?? credentials.bot });
  return guardians;
}

export async function linkedGuardians(): Promise<string[]> {
  return (await getCredentials())?.guardians ?? [];
}

export async function sendAlert(kind: EventKind | 'ask', host: string, code?: string): Promise<string | null> {
  const credentials = await getCredentials();
  if (!credentials || credentials.guardians.length === 0) return null;
  const { status, data } = await request<{ id: string }>(credentials, credentials.url, '/v1/alerts', {
    method: 'POST',
    body: { kind, host, code },
  });
  return status === 201 && data?.id ? data.id : null;
}

export async function alertStatus(alertId: string): Promise<AlertStatus | null> {
  const credentials = await getCredentials();
  if (!credentials) return null;
  const { data } = await request<AlertStatus>(credentials, credentials.url, `/v1/alerts/${alertId}`);
  return data && typeof data.status === 'string' ? data : null;
}

export async function sendTest(): Promise<boolean> {
  const credentials = await getCredentials();
  if (!credentials) return false;
  const { status } = await request(credentials, credentials.url, '/v1/test', { method: 'POST' });
  return status === 201;
}

export async function sendDeviceEvent(type: 'disabled' | 'pin-locked'): Promise<void> {
  const credentials = await getCredentials();
  if (!credentials || credentials.guardians.length === 0) return;
  await request(credentials, credentials.url, '/v1/events', { method: 'POST', body: { type } });
}

export async function heartbeat(): Promise<void> {
  const credentials = await getCredentials();
  if (credentials) await request(credentials, credentials.url, '/v1/heartbeat', { method: 'POST' });
}

export async function updateInstall(settings: Settings): Promise<void> {
  const credentials = await getCredentials();
  if (!credentials) return;
  await request(credentials, credentials.url, '/v1/installs/me', { method: 'PATCH', body: installFields(settings) });
}

/** Unlinks every trusted person and makes the relay forget this computer. */
export async function unlink(): Promise<void> {
  const credentials = await getCredentials();
  if (credentials) await request(credentials, credentials.url, '/v1/installs/me', { method: 'DELETE' });
  await saveCredentials(null);
  await applyUninstallUrl(null);
}

/** Six digits for the trusted person to read out by phone, and its hash to check it later. */
export async function newUnlockCode(eventId: string): Promise<{ code: string; hash: string }> {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  const code = String(value % 1_000_000).padStart(6, '0');
  return { code, hash: await codeHash(eventId, code) };
}

export async function codeHash(eventId: string, code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${eventId}:${code}`));
  return hex(new Uint8Array(digest));
}
