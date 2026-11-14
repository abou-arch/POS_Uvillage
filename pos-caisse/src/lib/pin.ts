// Vérification du PIN d'un responsable sur la caisse, même hors ligne (§11) : la caisse ne connaît que l'empreinte
// PBKDF2 (HMAC-SHA-256) du PIN, téléchargée avec la liste des responsables. Calcul fait par le navigateur (WebCrypto).
import type { Approver, PinHash } from '../types';
import { isRecord } from './storage';

export const MIN_ITERATIONS = 100_000; // §11
export const MAX_ITERATIONS = 5_000_000; // au-delà, la vérification bloquerait la caisse plusieurs secondes
const SALT_MIN_BYTES = 16;
const HASH_BYTES = 32;

/** Base64 → octets ; null si le texte n'est pas du base64 valide. */
export function decodeBase64(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) return null;
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export const isPinHash = (v: unknown): v is PinHash =>
  isRecord(v) && v.algorithm === 'PBKDF2-SHA256'
  && Number.isInteger(v.iterations) && (v.iterations as number) >= MIN_ITERATIONS && (v.iterations as number) <= MAX_ITERATIONS
  && typeof v.salt === 'string' && (decodeBase64(v.salt)?.length ?? 0) >= SALT_MIN_BYTES
  && typeof v.hash === 'string' && decodeBase64(v.hash)?.length === HASH_BYTES;

/** Un responsable de la liste du §11, complet et utilisable. */
export const isApprover = (v: unknown): v is Approver =>
  isRecord(v) && typeof v.user_id === 'string' && v.user_id !== '' && typeof v.name === 'string' && v.name.trim() !== ''
  && isPinHash(v.pin);

/** Le PIN tapé : des chiffres seulement, 4 au moins (la longueur exacte est fixée par le back-office, §8 point 10). */
export const isPinFormat = (pin: string) => /^\d{4,12}$/.test(pin);

/** Comparaison en temps constant : la durée ne dit pas combien d'octets sont justes. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Empreinte PBKDF2-SHA256 d'un PIN, sur la longueur de `hash`. */
async function derive(pin: string, salt: Uint8Array, iterations: number, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, bytes * 8,
  );
  return new Uint8Array(bits);
}

/** Le PIN correspond-il à l'empreinte ? Une empreinte illisible ne correspond à rien. */
export async function pinMatches(pin: string, h: PinHash): Promise<boolean> {
  const salt = decodeBase64(h.salt);
  const expected = decodeBase64(h.hash);
  if (!salt || !expected || expected.length === 0 || !Number.isInteger(h.iterations) || h.iterations < 1) return false;
  return sameBytes(await derive(pin, salt, h.iterations, expected.length), expected);
}
