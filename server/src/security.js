// Mots de passe, tokens de connexion et PIN des responsables. Rien de tout cela n'est gardé en clair.
import { createHash, pbkdf2Sync, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// --- Mots de passe : scrypt, sel aléatoire ---------------------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [algo, n, salt, hash] = String(stored).split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: SCRYPT.r, p: SCRYPT.p });
  return timingSafeEqual(actual, expected);
}

/** Mot de passe acceptable : 8 caractères au moins (les comptes de démonstration sont créés à part). */
export const passwordProblem = (password) =>
  typeof password !== 'string' || password.length < 8 ? 'Le mot de passe doit faire au moins 8 caractères.'
    : password.length > 200 ? 'Mot de passe trop long.' : null;

// --- Tokens : aléatoires, gardés en empreinte SHA-256, durée de vie limitée, révocables -----------------------

export const newToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (token) => createHash('sha256').update(String(token)).digest('hex');

// --- PIN des responsables (§11) : empreinte PBKDF2-SHA256 envoyée aux caisses, jamais le PIN --------------------

export const PIN_ITERATIONS = 600_000;

/** PIN de 6 chiffres exactement (docs/SECURITE.md : 4 chiffres se cassent trop vite). */
export const pinProblem = (pin) => (/^\d{6}$/.test(String(pin ?? '')) ? null : 'Le PIN doit faire exactement 6 chiffres.');

export function hashPin(pin, iterations = PIN_ITERATIONS) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(String(pin), salt, iterations, 32, 'sha256');
  return { algorithm: 'PBKDF2-SHA256', iterations, salt: salt.toString('base64'), hash: hash.toString('base64') };
}
