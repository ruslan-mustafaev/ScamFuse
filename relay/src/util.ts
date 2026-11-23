// Small helpers: hashing, random identifiers, JSON responses.

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compares two strings in time that does not depend on where they differ. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomId(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

/** Eight digits, easy to type into Telegram by hand. */
export function pairingCode(): string {
  const values = crypto.getRandomValues(new Uint32Array(2));
  return `${(values[0] ?? 0) % 10000}`.padStart(4, '0') + `${(values[1] ?? 0) % 10000}`.padStart(4, '0');
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function error(code: string, status: number): Response {
  return json({ ok: false, error: code }, status);
}

/** "evil.example.com" → "evil[.]example[.]com": Telegram does not turn it into a link. */
export function defang(host: string): string {
  return host.replace(/\./g, '[.]');
}

export function cleanHost(value: unknown): string {
  return typeof value === 'string' && /^[a-z0-9.-]{0,253}$/i.test(value) ? value.toLowerCase() : '';
}

export function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
}
