// Application Express : connexion (§2), contrôle du token, routes de la caisse et du back-office, erreurs au format
// du contrat ({ error: { code, message, details } }).
import cors from 'cors';
import express from 'express';
import { publicStore, storeIdsOf } from './core.js';
import { all, get, nowIso, run } from './db.js';
import { adminRoutes } from './routes/admin.js';
import { posRoutes } from './routes/pos.js';
import { newToken, tokenHash, verifyPassword } from './security.js';
import { fail, HttpError } from './validate.js';

// Connexion : 5 essais ratés de suite bloquent le compte 15 minutes (docs/SECURITE.md, proposition 4).
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const BAD_CREDENTIALS = 'Identifiants incorrects';

/**
 * @param {object} options
 * @param {import('node:sqlite').DatabaseSync} options.db
 * @param {number} [options.tokenTtlHours] durée de vie d'un token (7 jours par défaut : la caisse travaille hors ligne)
 * @param {string[]|null} [options.corsOrigins] origines autorisées ; null = toutes (développement)
 * @param {number} [options.pinIterations] itérations PBKDF2 des PIN (600 000 ; moins dans les tests)
 */
export function createApp({ db, tokenTtlHours = 168, corsOrigins = null, pinIterations }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: corsOrigins ?? true }));
  app.use(express.json({ limit: '5mb' })); // un lot de 200 ventes hors ligne

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || username.length > 100) {
      fail(401, 'BAD_CREDENTIALS', BAD_CREDENTIALS);
    }
    const name = username.trim();
    const lock = get(db, 'SELECT failures, locked_until FROM login_failures WHERE username = ?', name);
    if (lock?.locked_until && lock.locked_until > nowIso()) fail(401, 'BAD_CREDENTIALS', BAD_CREDENTIALS);
    const user = get(db, 'SELECT * FROM users WHERE username = ? AND active = 1', name);
    // Mot de passe vérifié même pour un compte inconnu : même durée de réponse, on ne devine pas les comptes.
    const ok = verifyPassword(password, user?.password_hash ?? DUMMY_HASH) && Boolean(user);
    if (!ok) {
      const failures = (lock && !lock.locked_until ? lock.failures : 0) + 1;
      const lockedUntil = failures >= MAX_FAILURES ? nowIso(new Date(Date.now() + LOCK_MINUTES * 60_000)) : null;
      run(db, `INSERT INTO login_failures (username, failures, locked_until) VALUES (?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until`,
      name, lockedUntil ? 0 : failures, lockedUntil);
      fail(401, 'BAD_CREDENTIALS', BAD_CREDENTIALS);
    }
    run(db, 'DELETE FROM login_failures WHERE username = ?', name);
    run(db, 'DELETE FROM auth_tokens WHERE expires_at <= ?', nowIso());
    const token = newToken();
    run(db, 'INSERT INTO auth_tokens (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      tokenHash(token), user.id, nowIso(), nowIso(new Date(Date.now() + tokenTtlHours * 3_600_000)));
    const storeIds = storeIdsOf(db, user);
    const stores = storeIds.length ? all(db, `SELECT * FROM stores WHERE id IN (${storeIds.map(() => '?').join(',')}) ORDER BY name`, ...storeIds) : [];
    res.json({
      token,
      user: { id: user.id, name: user.name, role: user.role },
      stores: stores.map((s) => publicStore(db, s)),
    });
  });

  // Toutes les autres routes : token valide, non expiré, d'un utilisateur actif.
  app.use('/api', (req, _res, next) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const row = token ? get(db, `SELECT u.id, u.name, u.role, u.username FROM auth_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ? AND t.expires_at > ? AND u.active = 1`, tokenHash(token), nowIso()) : null;
    if (!row) fail(401, 'UNAUTHENTICATED', 'Connexion requise');
    req.user = { ...row, store_ids: storeIdsOf(db, row), token_hash: tokenHash(token) };
    next();
  });

  // Déconnexion : le token est révoqué (docs/SECURITE.md, proposition 5 ; contrat §12 proposé).
  app.post('/api/auth/logout', (req, res) => {
    run(db, 'DELETE FROM auth_tokens WHERE token_hash = ?', req.user.token_hash);
    res.status(204).end();
  });

  app.use('/api/admin', adminRoutes(db, { pinIterations }));
  app.use('/api', posRoutes(db));

  app.use('/api', () => fail(404, 'NOT_FOUND', 'Route inconnue'));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details ?? {} } });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'INVALID_DATA', message: 'JSON invalide', details: {} } });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Requête trop grosse', details: {} } });
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Erreur du serveur', details: {} } });
  });

  return app;
}

// Empreinte d'un mot de passe que personne n'a : sert à vérifier « pour rien » quand le compte n'existe pas.
const DUMMY_HASH = 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
