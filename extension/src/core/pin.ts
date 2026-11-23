// PIN storage: PBKDF2-SHA-256 with a random salt. The PIN itself is never stored.

import type { PinRecord } from './types.ts';

export const PIN_ITERATIONS = 210_000;
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 15;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPin(pin: string, iterations = PIN_ITERATIONS): Promise<PinRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, iterations);
  return { salt: toBase64(salt), hash: toBase64(hash), iterations };
}

export async function verifyPin(pin: string, record: PinRecord): Promise<boolean> {
  const actual = await derive(pin, fromBase64(record.salt), record.iterations);
  const expected = fromBase64(record.hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) diff |= (actual[i] ?? 0) ^ (expected[i] ?? 0);
  return diff === 0;
}

export interface PinGuard {
  fails: number;
  lockedUntil: number;
}

/** Updates the attempt counter after a check. Five wrong attempts lock input for 15 minutes. */
export function nextGuard(guard: PinGuard, ok: boolean, now: number): PinGuard {
  if (ok) return { fails: 0, lockedUntil: 0 };
  const fails = guard.fails + 1;
  return fails >= PIN_MAX_ATTEMPTS
    ? { fails: 0, lockedUntil: now + PIN_LOCK_MINUTES * 60_000 }
    : { fails, lockedUntil: guard.lockedUntil };
}
