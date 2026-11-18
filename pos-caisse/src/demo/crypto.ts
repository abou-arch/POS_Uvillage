// Remplace « node:crypto » pour la démo (build --mode demo) : la fausse API calcule au démarrage l'empreinte
// PBKDF2-SHA256 du PIN de chaque responsable (§11). Le navigateur n'a qu'une version asynchrone (Web Crypto),
// alors que server.js l'appelle de façon synchrone : d'où ce SHA-256 écrit ici. Seules les fonctions qu'utilise
// server.js existent.

/** Octets qui, comme un Buffer de Node, s'écrivent en base64 avec toString('base64'). */
export class Bytes extends Uint8Array {
  toString(encoding?: string): string {
    if (encoding !== 'base64') return super.toString();
    let binary = '';
    for (const b of this) binary += String.fromCharCode(b);
    return btoa(binary);
  }
}

// Sels tirés d'avance par precomputePbkdf2, rendus dans l'ordre par randomBytes.
const pendingSalts: Bytes[] = [];
// Empreintes déjà calculées (Web Crypto), par mot de passe, sel, itérations et longueur.
const derived = new Map<string, Bytes>();
const cacheKey = (password: Uint8Array, salt: Uint8Array, iterations: number, keylen: number) =>
  `${new Bytes(password).toString('base64')}|${new Bytes(salt).toString('base64')}|${iterations}|${keylen}`;

export function randomBytes(size: number): Bytes {
  const ready = pendingSalts.findIndex((s) => s.length === size);
  if (ready >= 0) return pendingSalts.splice(ready, 1)[0];
  const bytes = new Bytes(size);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Prépare, avant que server.js ne démarre, l'empreinte des PIN : un sel aléatoire par mot de passe, servi ensuite
 * par randomBytes, et l'empreinte calculée par Web Crypto (natif, rapide), que pbkdf2Sync retrouve. Sans cela,
 * 600 000 itérations par PIN en JavaScript bloqueraient l'affichage plusieurs secondes. Même résultat dans les deux cas.
 */
export async function precomputePbkdf2(passwords: string[], iterations: number, keylen: number, saltSize: number) {
  await Promise.all(passwords.map(async (password) => {
    const salt = new Bytes(saltSize);
    globalThis.crypto.getRandomValues(salt);
    pendingSalts.push(salt);
    const secret = new TextEncoder().encode(password);
    const key = await globalThis.crypto.subtle.importKey('raw', secret, 'PBKDF2', false, ['deriveBits']);
    const bits = await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, keylen * 8);
    derived.set(cacheKey(secret, salt, iterations, keylen), new Bytes(bits));
  }));
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/** Un bloc SHA-256 : W[0..15] contient le bloc (W est réécrit), h est l'état de départ, out reçoit le nouvel état. */
function compress(h: Uint32Array, w: Uint32Array, out: Uint32Array) {
  for (let t = 16; t < 64; t++) {
    const a = w[t - 15], b = w[t - 2];
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
    w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
  }
  let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
  for (let t = 0; t < 64; t++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (k + S1 + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  out[0] = (h[0] + a) | 0; out[1] = (h[1] + b) | 0; out[2] = (h[2] + c) | 0; out[3] = (h[3] + d) | 0;
  out[4] = (h[4] + e) | 0; out[5] = (h[5] + f) | 0; out[6] = (h[6] + g) | 0; out[7] = (h[7] + k) | 0;
}

/** SHA-256 de `data`, en reprenant l'état `start` après `prefixLength` octets déjà traités (multiple de 64). */
function digest(data: Uint8Array, start: Uint32Array = Uint32Array.from(INITIAL), prefixLength = 0): Uint32Array {
  const total = prefixLength + data.length;
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((total * 8) / 2 ** 32));
  view.setUint32(padded.length - 4, (total * 8) >>> 0);
  const h = Uint32Array.from(start);
  const w = new Uint32Array(64);
  for (let i = 0; i < padded.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4);
    compress(h, w, h);
  }
  return h;
}

/** État SHA-256 après un bloc de 64 octets (clé HMAC XOR ipad ou opad). */
function afterBlock(block: Uint8Array): Uint32Array {
  const view = new DataView(block.buffer, block.byteOffset, 64);
  const w = new Uint32Array(64);
  for (let j = 0; j < 16; j++) w[j] = view.getUint32(j * 4);
  const h = new Uint32Array(8);
  compress(Uint32Array.from(INITIAL), w, h);
  return h;
}

const toBytes = (v: string | Uint8Array) => (typeof v === 'string' ? new TextEncoder().encode(v) : v);

/** Même résultat que pbkdf2Sync de Node, pour SHA-256 seulement. */
export function pbkdf2Sync(password: string | Uint8Array, salt: string | Uint8Array, iterations: number, keylen: number, algorithm: string): Bytes {
  if (algorithm.toLowerCase() !== 'sha256') throw new Error(`Démo : PBKDF2 avec ${algorithm} non pris en charge`);
  const ready = derived.get(cacheKey(toBytes(password), toBytes(salt), iterations, keylen));
  if (ready) return new Bytes(ready);
  let key = toBytes(password);
  if (key.length > 64) key = wordsToBytes(digest(key));
  const ipad = new Uint8Array(64).fill(0x36), opad = new Uint8Array(64).fill(0x5c);
  key.forEach((b, i) => { ipad[i] ^= b; opad[i] ^= b; });
  const inner = afterBlock(ipad), outer = afterBlock(opad);
  const hmac = (message: Uint8Array) => digest(wordsToBytes(digest(message, inner, 64)), outer, 64);

  const saltBytes = toBytes(salt);
  const result = new Bytes(keylen);
  const w = new Uint32Array(64);
  const u = new Uint32Array(8), t = new Uint32Array(8), acc = new Uint32Array(8);
  for (let block = 1, offset = 0; offset < keylen; block++, offset += 32) {
    const first = new Uint8Array(saltBytes.length + 4);
    first.set(saltBytes);
    new DataView(first.buffer).setUint32(saltBytes.length, block);
    u.set(hmac(first));
    acc.set(u);
    // Itérations suivantes : HMAC d'un message de 32 octets = deux blocs SHA-256, longueur fixe (64 + 32 octets).
    for (let i = 1; i < iterations; i++) {
      w.set(u); w[8] = 0x80000000; w.fill(0, 9, 15); w[15] = 768;
      compress(inner, w, t);
      w.set(t); w[8] = 0x80000000; w.fill(0, 9, 15); w[15] = 768;
      compress(outer, w, u);
      for (let j = 0; j < 8; j++) acc[j] ^= u[j];
    }
    result.set(wordsToBytes(acc).subarray(0, Math.min(32, keylen - offset)), offset);
  }
  return result;
}

function wordsToBytes(words: Uint32Array): Uint8Array {
  const bytes = new Uint8Array(words.length * 4);
  const view = new DataView(bytes.buffer);
  words.forEach((v, i) => view.setUint32(i * 4, v));
  return bytes;
}

/** SHA-256 d'un texte ou d'octets (pour les tests). */
export const sha256 = (data: string | Uint8Array) => wordsToBytes(digest(toBytes(data)));
